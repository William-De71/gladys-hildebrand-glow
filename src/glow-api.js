// -----------------------------------------------------------------------------
// Client of the Glowmarkt API (Hildebrand), the cloud behind the Bright app,
// with the e-mail and the password of the Bright account.
//
// Official documentation (Swagger, "Resource System" and "Virtual Entity
// System"): https://api.glowmarkt.com/api-docs/v0-1/resourcesys/ and
// https://api.glowmarkt.com/api-docs/v0-1/vesys/
//
//   POST /auth                                 { username, password } -> { valid, token, exp }
//   GET  /virtualentity                        the homes of the account
//   GET  /virtualentity/{id}/resources         their resources (classifier)
//   GET  /resource/{id}/readings               ?from&to&period&function&offset&nulls
//   GET  /resource/{id}/current                latest instantaneous reading (W)
//   GET  /resource/{id}/tariff                 latest tariff (pence)
//   GET  /resource/{id}/catchup                asks Hildebrand to fetch the DCC
//
// Every request carries the public `applicationId` of the Bright app (the
// one of the documentation and of every client of this API), and, once
// signed in, the `token` header.
//
// - Requests go one at a time, 1 s apart at least: the API documents no
//   limit, the integration stays light (a reading every 30 minutes).
// - The token lives about 7 days (`exp`, in seconds): renewed 1 hour before,
//   and once more when the API answers 401 / 403, or 404: checked on
//   2026-10-28, an invalid token gets `404 {"error":"Not found"}`.
// - 429 is reported as a RateLimitError (Retry-After honoured), 5xx as an
//   ApiError: the caller slows down.
// - The password and the token are never logged nor put in an error message.
// -----------------------------------------------------------------------------

const API_URL = 'https://api.glowmarkt.com/api/v0-1';
// The public application id of the Bright app.
const APPLICATION_ID = 'b0f1b774-a586-4f72-9edd-27ead8aa7a8d';
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 30 * 1000;
// Renew the token this long before it expires.
const TOKEN_MARGIN_MS = 60 * 60 * 1000;
// Lifetime assumed when the answer gives no `exp`.
const DEFAULT_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
// A 429 without Retry-After asks to wait this long.
const RATE_LIMIT_WAIT_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The e-mail / password pair is refused. */
class CredentialsError extends Error {
  /**
   * @param {string} reason - MISSING, INVALID, UNAUTHORIZED.
   * @param {number|null} status - HTTP status.
   */
  constructor(reason, status = null) {
    super(`Glowmarkt refused the credentials (${reason})`);
    this.name = 'CredentialsError';
    this.reason = reason;
    this.status = status;
  }
}

/** Glowmarkt asks to slow down (429). */
class RateLimitError extends Error {
  /** @param {number} retryAfterMs - The wait before the next request. */
  constructor(retryAfterMs) {
    super('Glowmarkt limits the requests');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Any other HTTP error of the API. */
class ApiError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} [detail] - A short detail, free of any secret.
   */
  constructor(status, detail = '') {
    super(`Glowmarkt API error ${status}${detail ? ` (${detail})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The API cannot be reached (DNS, timeout, connection refused). */
class NetworkError extends Error {
  /** @param {string} message - What failed (never a URL with a secret). */
  constructor(message) {
    super(`Glowmarkt API unreachable: ${message}`);
    this.name = 'NetworkError';
  }
}

/**
 * @description A date as the readings endpoint wants it: UTC, no zone,
 * no milliseconds ("2026-10-28T00:00:00").
 * @param {number} ms - The instant.
 * @returns {string} The text.
 */
const apiDate = (ms) => new Date(ms).toISOString().slice(0, 19);

/**
 * @description The Retry-After header, in ms.
 * @param {string|null} value - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} The wait (null: absent or unreadable).
 */
function retryAfterMs(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * @description Create a Glowmarkt API client.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetchImpl] - `fetch` (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {number} [options.minIntervalMs] - Spacing of two API requests.
 * @param {number} [options.timeoutMs] - Timeout of a request.
 * @param {string} [options.userAgent] - User-Agent header.
 * @returns {object} The client.
 * @example
 * const api = createGlowApi();
 * api.setCredentials('me@example.com', 'password');
 * const entities = await api.getVirtualEntities();
 */
function createGlowApi({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minIntervalMs = MIN_INTERVAL_MS,
  timeoutMs = TIMEOUT_MS,
  userAgent = 'gladys-hildebrand-glow',
} = {}) {
  let username = '';
  let password = '';
  let token = null;
  let tokenRefreshAt = 0;
  let tokenRequest = null;
  let queue = Promise.resolve();
  let nextSlot = 0;
  const sentAt = [];

  /** @description Forget the requests older than an hour. */
  function prune() {
    const limit = now() - HOUR_MS;
    while (sentAt.length && sentAt[0] < limit) sentAt.shift();
  }

  /**
   * @description One HTTP exchange.
   * @param {string} url - The URL.
   * @param {object} init - The fetch options.
   * @returns {Promise<{status: number, body: unknown, retryAfter: number|null}>} The answer.
   */
  async function send(url, init) {
    sentAt.push(now());
    prune();
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? 'network');
      throw new NetworkError(reason);
    }
    const text = await response.text().catch(() => '');
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    const header = response.headers?.get?.('retry-after') ?? null;
    return { status: response.status, body, retryAfter: retryAfterMs(header, now()) };
  }

  /**
   * @description Run a task in the queue, after the previous one.
   * @param {Function} task - `() => Promise`.
   * @returns {Promise<unknown>} Its result.
   */
  function enqueue(task) {
    const run = async () => {
      const wait = nextSlot - now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        nextSlot = now() + minIntervalMs;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  const baseHeaders = () => ({
    Accept: 'application/json',
    applicationId: APPLICATION_ID,
    'User-Agent': userAgent,
  });

  /** @description Sign in (POST /auth). */
  async function fetchToken() {
    if (!username || !password) throw new CredentialsError('MISSING');
    const answer = await send(`${API_URL}/auth`, {
      method: 'POST',
      headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (answer.status === 429) {
      throw new RateLimitError(answer.retryAfter ?? RATE_LIMIT_WAIT_MS);
    }
    // A wrong e-mail or password: `401 {"valid": false}` (checked on 2026-10-28).
    if ([400, 401, 403].includes(answer.status) || answer.body?.valid === false) {
      throw new CredentialsError('INVALID', answer.status);
    }
    if (answer.status >= 400) throw new ApiError(answer.status);
    const value = answer.body?.token;
    if (typeof value !== 'string' || !value) {
      throw new ApiError(answer.status, 'no token in the answer');
    }
    const exp = Number(answer.body?.exp);
    const expiresAt =
      Number.isFinite(exp) && exp > 0 ? exp * 1000 : now() + DEFAULT_TOKEN_LIFETIME_MS;
    token = value;
    tokenRefreshAt = Math.max(now(), expiresAt - TOKEN_MARGIN_MS);
    return token;
  }

  /** @description A valid token (shared by concurrent callers). */
  async function currentToken() {
    if (token && now() < tokenRefreshAt) return token;
    if (!tokenRequest) {
      tokenRequest = fetchToken().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  /**
   * @description GET an endpoint (in the queue), signed in.
   * @param {string} path - The path, with its query.
   * @returns {Promise<unknown>} The parsed answer.
   */
  function get(path) {
    return enqueue(async () => {
      for (let renewed = false; ; renewed = true) {
        const value = await currentToken();
        const answer = await send(`${API_URL}${path}`, {
          method: 'GET',
          headers: { ...baseHeaders(), token: value },
        });
        if (answer.status === 429) {
          throw new RateLimitError(answer.retryAfter ?? RATE_LIMIT_WAIT_MS);
        }
        if ([401, 403, 404].includes(answer.status) && !renewed) {
          // An expired token, or one the API no longer knows (404): sign in
          // once more, then the answer is the real one.
          token = null;
          continue;
        }
        if (answer.status === 401 || answer.status === 403) {
          throw new CredentialsError('UNAUTHORIZED', answer.status);
        }
        if (answer.status >= 400) {
          const detail =
            typeof answer.body?.error === 'string' ? answer.body.error.slice(0, 60) : '';
          throw new ApiError(answer.status, detail);
        }
        return answer.body;
      }
    });
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    /**
     * @description Use these credentials from now on (drops the token).
     * @param {string} email - The e-mail of the Bright account.
     * @param {string} secret - Its password.
     */
    setCredentials(email, secret) {
      const changed = email !== username || secret !== password;
      username = email ?? '';
      password = secret ?? '';
      if (changed) {
        token = null;
        tokenRefreshAt = 0;
      }
    },
    hasCredentials: () => Boolean(username && password),
    /** @returns {Promise<Array<object>>} The virtual entities (homes). */
    async getVirtualEntities() {
      const body = await get('/virtualentity');
      return Array.isArray(body) ? body : [];
    },
    /**
     * @param {string} veId - A virtual entity.
     * @returns {Promise<Array<object>>} Its resources.
     */
    async getResources(veId) {
      const body = await get(`/virtualentity/${id(veId)}/resources`);
      return Array.isArray(body?.resources) ? body.resources : [];
    },
    /**
     * @description The readings of a resource.
     * @param {string} resourceId - The resource.
     * @param {object} query - The query.
     * @param {number} query.from - Start (ms, included).
     * @param {number} query.to - End (ms).
     * @param {string} [query.period] - PT30M, PT1H, P1D…
     * @returns {Promise<{units: string|null, data: Array}>} The readings
     *   (`data`: `[unix seconds, value|null]`).
     */
    async getReadings(resourceId, { from, to, period = 'PT30M' }) {
      const query = new URLSearchParams({
        from: apiDate(from),
        to: apiDate(to),
        period,
        function: 'sum',
        // The dates are given in UTC: no offset.
        offset: '0',
        // A missing half-hour is null, not 0: it is filled later.
        nulls: '1',
      });
      const body = await get(`/resource/${id(resourceId)}/readings?${query}`);
      return {
        units: typeof body?.units === 'string' ? body.units : null,
        data: Array.isArray(body?.data) ? body.data : [],
      };
    },
    /**
     * @param {string} resourceId - The resource.
     * @returns {Promise<{units: string|null, data: Array}>} The current reading.
     */
    async getCurrent(resourceId) {
      const body = await get(`/resource/${id(resourceId)}/current`);
      return {
        units: typeof body?.units === 'string' ? body.units : null,
        data: Array.isArray(body?.data) ? body.data : [],
      };
    },
    /**
     * @param {string} resourceId - The resource.
     * @returns {Promise<Array<object>>} The `data` of the tariff answer.
     */
    async getTariff(resourceId) {
      const body = await get(`/resource/${id(resourceId)}/tariff`);
      return Array.isArray(body?.data) ? body.data : [];
    },
    /**
     * @description Ask Hildebrand to fetch the latest half-hours from the DCC
     * (asynchronous: the readings come a few minutes later).
     * @param {string} resourceId - The resource.
     * @returns {Promise<boolean>} Accepted.
     */
    async catchup(resourceId) {
      const body = await get(`/resource/${id(resourceId)}/catchup`);
      return body?.data?.valid !== false;
    },
    /** @returns {Promise<void>} Sign in now (the "Test" button). */
    async signIn() {
      await enqueue(async () => {
        token = null;
        await currentToken();
      });
    },
    /** @returns {number} Requests sent during the last hour. */
    requestsLastHour() {
      prune();
      return sentAt.length;
    },
  };
}

export {
  API_URL,
  APPLICATION_ID,
  MIN_INTERVAL_MS,
  RATE_LIMIT_WAIT_MS,
  TOKEN_MARGIN_MS,
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
  apiDate,
  createGlowApi,
};

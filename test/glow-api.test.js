// The HTTP client against a fake fetch: sign-in, headers, token renewal (on
// `exp`, 401 and the 404 an unknown token gets), 429, errors free of secrets,
// the readings query, the queue.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  API_URL,
  APPLICATION_ID,
  MIN_INTERVAL_MS,
  TOKEN_MARGIN_MS,
  CredentialsError,
  RateLimitError,
  ApiError,
  NetworkError,
  apiDate,
} from '../src/glow-api.js';
import { apiWithFetch } from './helpers/fixtures.js';

const SECRET = 'S3cret-password';
const signedIn = (clock, lifetimeS = 7 * 24 * 3600) => ({
  status: 200,
  body: {
    valid: true,
    token: 'jwt-token-1',
    exp: Math.floor(clock.now / 1000) + lifetimeS,
    userGroups: [],
    functionalGroupAccounts: [],
  },
});

test('signs in with the e-mail and password, then sends the token and the application id', async () => {
  let clockRef;
  const { api, fetch, clock } = apiWithFetch((url) =>
    url.endsWith('/auth') ? signedIn(clockRef) : { status: 200, body: [{ veId: 'v1' }] },
  );
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  assert.ok(api.hasCredentials());
  const entities = await api.getVirtualEntities();
  assert.deepEqual(entities, [{ veId: 'v1' }]);
  const [auth, list] = fetch.requests;
  assert.equal(auth.url, `${API_URL}/auth`);
  assert.equal(auth.method, 'POST');
  assert.deepEqual(JSON.parse(auth.body), { username: 'me@example.co.uk', password: SECRET });
  assert.equal(auth.headers.applicationId, APPLICATION_ID);
  assert.equal(list.url, `${API_URL}/virtualentity`);
  assert.equal(list.headers.token, 'jwt-token-1');
  assert.equal(list.headers.applicationId, APPLICATION_ID);
  assert.equal(api.requestsLastHour(), 2);
});

test('a refused sign-in (401 {"valid": false}, as checked live) is a CredentialsError without the password', async () => {
  const { api } = apiWithFetch(() => ({ status: 401, body: { valid: false } }));
  api.setCredentials('me@example.co.uk', SECRET);
  const error = await api.getVirtualEntities().catch((err) => err);
  assert.ok(error instanceof CredentialsError);
  assert.equal(error.reason, 'INVALID');
  assert.doesNotMatch(error.message, /S3cret/);
  const missing = apiWithFetch(() => ({ status: 200 })).api;
  await assert.rejects(missing.getVirtualEntities(), (err) => err.reason === 'MISSING');
});

test('the token is renewed an hour before it expires, and once on 401 or 404', async () => {
  let clockRef;
  let tokens = 0;
  let answers = [];
  const { api, fetch, clock } = apiWithFetch((url) => {
    if (url.endsWith('/auth')) {
      tokens += 1;
      return {
        ...signedIn(clockRef, 2 * 3600),
        body: { ...signedIn(clockRef, 2 * 3600).body, token: `t${tokens}` },
      };
    }
    return answers.shift() ?? { status: 200, body: [] };
  });
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  await api.getVirtualEntities();
  await api.getVirtualEntities();
  assert.equal(tokens, 1, 'the token is reused');
  clock.now += 2 * 3600 * 1000 - TOKEN_MARGIN_MS + 1000;
  await api.getVirtualEntities();
  assert.equal(tokens, 2, 'renewed before it expires');
  // An unknown token gets 404 {"error":"Not found"} (checked on 2026-10-28).
  answers = [
    { status: 404, body: { error: 'Not found' } },
    { status: 200, body: [{ veId: 'x' }] },
  ];
  assert.deepEqual(await api.getVirtualEntities(), [{ veId: 'x' }]);
  assert.equal(tokens, 3);
  assert.equal(fetch.requests.at(-1).headers.token, 't3');
  // A real 404 after a new token is an ApiError, not a loop.
  answers = [
    { status: 404, body: { error: 'Not found' } },
    { status: 404, body: { error: 'Not found' } },
  ];
  await assert.rejects(
    api.getTariff('nope'),
    (err) => err instanceof ApiError && err.status === 404,
  );
  // 401 twice: the credentials no longer work.
  answers = [{ status: 401 }, { status: 401 }];
  await assert.rejects(api.getVirtualEntities(), (err) => err.reason === 'UNAUTHORIZED');
});

test('429 is a RateLimitError with the Retry-After of the answer; 5xx an ApiError', async () => {
  let clockRef;
  let answer = { status: 429, headers: { 'Retry-After': '120' } };
  const { api, clock } = apiWithFetch((url) =>
    url.endsWith('/auth') ? signedIn(clockRef) : answer,
  );
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  const error = await api.getVirtualEntities().catch((err) => err);
  assert.ok(error instanceof RateLimitError);
  assert.equal(error.retryAfterMs, 120000);
  answer = { status: 503, body: { error: 'An error has occurred' } };
  await assert.rejects(
    api.getVirtualEntities(),
    (err) => err instanceof ApiError && err.status === 503,
  );
});

test('a network failure is a NetworkError that names no secret', async () => {
  const { api } = apiWithFetch(() => {
    throw Object.assign(new Error('boom'), { cause: { code: 'ENOTFOUND' } });
  });
  api.setCredentials('me@example.co.uk', SECRET);
  const error = await api.getVirtualEntities().catch((err) => err);
  assert.ok(error instanceof NetworkError);
  assert.match(error.message, /ENOTFOUND/);
  assert.doesNotMatch(error.message, /S3cret|example/);
});

test('readings: UTC dates without zone, sum, offset 0, nulls 1; the other endpoints', async () => {
  let clockRef;
  const { api, fetch, clock } = apiWithFetch((url) => {
    if (url.endsWith('/auth')) return signedIn(clockRef);
    if (url.includes('/readings')) return { status: 200, body: { units: 'kWh', data: [[1, 0.5]] } };
    if (url.includes('/current')) return { status: 200, body: { units: 'W', data: [[1, 950]] } };
    if (url.includes('/tariff')) return { status: 200, body: { data: [{ name: 'x' }] } };
    if (url.includes('/catchup')) return { status: 200, body: { data: { valid: true } } };
    return { status: 200, body: { resources: [{ resourceId: 'r1' }] } };
  });
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  const from = Date.parse('2026-10-27T00:00:00Z');
  const to = Date.parse('2026-10-28T14:20:00.123Z');
  assert.deepEqual(await api.getReadings('r/1', { from, to }), { units: 'kWh', data: [[1, 0.5]] });
  const url = new URL(fetch.requests.at(-1).url);
  assert.equal(url.pathname, '/api/v0-1/resource/r%2F1/readings');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    from: '2026-10-27T00:00:00',
    to: '2026-10-28T14:20:00',
    period: 'PT30M',
    function: 'sum',
    offset: '0',
    nulls: '1',
  });
  assert.deepEqual(await api.getCurrent('r1'), { units: 'W', data: [[1, 950]] });
  assert.deepEqual(await api.getTariff('r1'), [{ name: 'x' }]);
  assert.equal(await api.catchup('r1'), true);
  assert.deepEqual(await api.getResources('v1'), [{ resourceId: 'r1' }]);
  assert.equal(new URL(fetch.requests.at(-1).url).pathname, '/api/v0-1/virtualentity/v1/resources');
  assert.equal(apiDate(Date.parse('2026-01-02T03:04:05.678Z')), '2026-01-02T03:04:05');
});

test('requests go one at a time, 1 s apart', async () => {
  let clockRef;
  const { api, clock } = apiWithFetch((url) =>
    url.endsWith('/auth') ? signedIn(clockRef) : { status: 200, body: [] },
  );
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  await Promise.all([api.getVirtualEntities(), api.getVirtualEntities(), api.getVirtualEntities()]);
  assert.deepEqual(clock.slept, [MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
});

test('new credentials drop the token; the same ones keep it', async () => {
  let clockRef;
  let tokens = 0;
  const { api, clock } = apiWithFetch((url) => {
    if (url.endsWith('/auth')) {
      tokens += 1;
      return signedIn(clockRef);
    }
    return { status: 200, body: [] };
  });
  clockRef = clock;
  api.setCredentials('me@example.co.uk', SECRET);
  await api.getVirtualEntities();
  api.setCredentials('me@example.co.uk', SECRET);
  await api.getVirtualEntities();
  assert.equal(tokens, 1);
  api.setCredentials('other@example.co.uk', SECRET);
  await api.getVirtualEntities();
  assert.equal(tokens, 2);
  await api.signIn();
  assert.equal(tokens, 3, 'the Test button signs in again');
});

// -----------------------------------------------------------------------------
// The Hildebrand Glow integration: every handler, registered on a Gladys
// client.
//
//   - the meters come from the virtual entities of the Bright account and
//     their resources (glow.js): one Gladys device per meter (device.js);
//   - the integration has its own clock, never Gladys polling
//     (`should_poll: false`), paced on the half-hours of the DCC:
//       · just after each half-hour (1 to 3 min, random, as the Glowmarkt
//         documentation asks), one `catchup` per meter asks Hildebrand to
//         fetch the DCC;
//       · 10 minutes after each half-hour (or each hour), the half-hours of
//         yesterday and today are read (consumption, and cost when the
//         account has one): today / yesterday totals, the 24-hour chart, the
//         scene triggers; the new or corrected electricity half-hours go to
//         Gladys at their real time (publishEnergyConsumption);
//       · every 6 hours: the list of meters and the tariffs;
//       · every 1 to 10 minutes: the power, only for a meter whose
//         `current` answers (a Glow display);
//   - once a meter is added, its history (0 to 90 days) is read once, 10
//     days per request, and given to Gladys;
//   - one queue of requests, 1 s apart (glow-api.js); a 429 or an error
//     slows everything down, refused credentials are tried again every
//     30 minutes or as soon as they change.
//
// Transport: cloud (Glowmarkt API). index.js only creates the SDK client;
// the tests drive this module with the fake Gladys of the SDK and a fake API.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  resolveTimezone,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import {
  SLOT_MS,
  DAY_MS,
  parseMeters,
  parseReadings,
  parseTariff,
  parseCurrent,
  sumByDay,
  splitRange,
  dayOf,
  midnightOf,
  addDays,
  slotsOfDay,
} from './glow.js';
import { createGlowApi, CredentialsError, RateLimitError, ApiError } from './glow-api.js';
import {
  buildDevice,
  buildStates,
  featuresOf,
  idsOf,
  deviceName,
  discoverySignature,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  DEFAULT_PERIOD,
  detectEvents,
  periodDates,
  datesBetween,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  RANGES,
  buildMeterWidget,
  buildStatusWidget,
  formatLatest,
} from './widgets.js';
import { createState, DEFAULT_PATH } from './state.js';
import { t, all, isLanguage, ago } from './i18n.js';

const ACTIONS = { TEST: 'test_connection' };
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// The clock: what is due is checked this often.
const TICK_MS = 30 * 1000;
// After each half-hour: the catchup, then the reading.
const CATCHUP_DELAY_MS = 1 * MINUTE_MS;
const CATCHUP_JITTER_MS = 2 * MINUTE_MS;
const READ_DELAY_MS = 10 * MINUTE_MS;
const READ_JITTER_MS = 1 * MINUTE_MS;
// The list of meters and the tariffs.
const DISCOVERY_EVERY_MS = 6 * HOUR_MS;
const TARIFF_EVERY_MS = 6 * HOUR_MS;
// A meter without power reading is asked again this often.
const POWER_PROBE_EVERY_MS = 24 * HOUR_MS;
// A refresh button or action reads again only past this delay.
const MIN_MANUAL_GAP_MS = 5 * MINUTE_MS;
// Refused credentials are tried again this often.
const REFUSED_RETRY_MS = 30 * MINUTE_MS;
// After an error: 5, 10, 20, then 30 minutes. After a 429: up to 2 hours.
const ERROR_RETRY_MS = 5 * MINUTE_MS;
const MAX_ERROR_RETRY_MS = 30 * MINUTE_MS;
const MAX_RATE_LIMIT_PAUSE_MS = 2 * HOUR_MS;
// requestWidgetRefresh: at most once every 10 s per widget.
const WIDGET_REFRESH_GAP_MS = 10 * 1000;
// publishChangedStates also re-sends an unchanged value this old.
const HEARTBEAT_MS = 30 * MINUTE_MS;
// publishEnergyConsumption takes 2 000 intervals at most.
const MAX_INTERVALS = 2000;

/**
 * @description The next instant `offset` after a multiple of `period`, after now.
 * @param {number} now - Now (ms).
 * @param {number} period - The period (ms).
 * @param {number} offset - The offset after each multiple (ms).
 * @returns {number} The instant.
 */
function nextAfter(now, period, offset) {
  let at = Math.floor(now / period) * period + offset;
  while (at <= now) at += period;
  return at;
}

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {object} [options.api] - A Glowmarkt API client (tests).
 * @param {Function} [options.now] - `() => ms` (tests).
 * @param {Function} [options.random] - `() => [0, 1)` (tests).
 * @param {string|null} [options.statePath] - File of the state (null: memory).
 * @param {number} [options.tickMs] - Clock period, 0 for none (tests).
 * @param {string} [options.timezone] - IANA timezone (days, language guess).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    api = createGlowApi(),
    now = () => Date.now(),
    random = Math.random,
    statePath = DEFAULT_PATH,
    tickMs = TICK_MS,
    timezone = resolveTimezone(),
    logger = sdkLogger,
  } = {},
) {
  const state = createState({ path: statePath, logger });
  let config = normalizeConfig({});
  let language = null;
  let meters = [];
  let lastDiscovery = null;
  let connection = 'unknown';
  let connectionDetail = null;
  let lastSuccessAt = 0;
  let lastManualAt = 0;
  let pausedUntil = 0;
  let backoff = 0;
  let lastStatus = null;
  let timer = null;
  let chain = Promise.resolve();
  const due = { discovery: 0, tariff: 0, catchup: 0, read: 0, power: 0 };
  // meter id -> { watts, at }
  const power = new Map();
  const widgetRefreshedAt = new Map();

  const textLanguage = () =>
    config.language !== AUTO_LANGUAGE ? config.language : (language ?? guessLanguage(timezone));
  const periodMs = () => config.refreshMinutes * MINUTE_MS;
  const withHome = () => new Set(meters.map((meter) => meter.veId)).size > 1;
  const nameOf = (meter, lang = textLanguage()) => deviceName(meter, lang, withHome());
  // Widgets: the short name of the energy ("Electricity", "Gas (Cottage)").
  const shortNameOf = (meter, lang) => {
    const name = t(`commodity_${meter.commodity}`, lang);
    return withHome() && meter.veName ? `${name} (${meter.veName})` : name;
  };
  const externalIdOf = (meter) => idsOf(gladys, meter.id).device;
  const createdIds = () => new Set((gladys.devices ?? []).map((device) => device.external_id));
  const isCreated = (meter) => createdIds().has(externalIdOf(meter));
  const byExternalId = (externalId) =>
    meters.find((meter) => externalIdOf(meter) === externalId) ?? null;

  /**
   * @description Run one API flow at a time (clock, buttons, actions).
   * @param {Function} task - `() => Promise`.
   * @returns {Promise<unknown>} Its result.
   */
  function exclusive(task) {
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Everything known about a meter.
   * @param {object} meter - The meter.
   * @returns {object} The model (device.js, widgets.js, events.js).
   */
  function modelOf(meter) {
    const days = state.get(meter.id, 'days') ?? {};
    const today = dayOf(now(), timezone);
    const day = (date) => {
      const entry = days[date];
      if (!entry) return null;
      return { kwh: entry.kwh ?? null, pence: meter.costId ? (entry.pence ?? null) : null };
    };
    const tariff = state.get(meter.id, 'tariff') ?? null;
    const seen = state.get(meter.id, 'tariffSeen') ?? {};
    const probe = state.get(meter.id, 'power') ?? {};
    return {
      ...meter,
      days,
      halfHours: state.get(meter.id, 'halfHours') ?? {},
      latest: state.get(meter.id, 'latest') ?? null,
      today: day(today),
      yesterday: day(addDays(today, -1)),
      tariff,
      hasRate: Boolean(seen.rate),
      hasStanding: Boolean(seen.standing),
      hasPower: meter.commodity === 'electricity' && Boolean(probe.has),
      power: power.get(meter.id) ?? null,
    };
  }

  // --- Publishing ---------------------------------------------------------------

  /** @description Offer every meter on the Discovery screen. */
  async function publishDiscovery({ force = false } = {}) {
    if (!gladys.connected) return;
    const models = meters.map(modelOf);
    const signature = discoverySignature(gladys, models, textLanguage(), withHome());
    if (!force && signature === lastDiscovery) return;
    try {
      await gladys.publishDiscoveredDevices(
        models.map((model) => buildDevice(gladys, model, textLanguage(), withHome())),
      );
      lastDiscovery = signature;
    } catch (err) {
      logger.error('Unable to publish the discovered devices', err);
    }
  }

  /**
   * @description Publish the changed states of the meters the user created.
   * @param {object[]} [list] - Meters (all by default).
   */
  async function publishStates(list = meters) {
    if (!gladys.connected) return;
    const created = createdIds();
    const states = list
      .filter((meter) => created.has(externalIdOf(meter)))
      .flatMap((meter) => buildStates(gladys, modelOf(meter)));
    if (states.length === 0) return;
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      logger.error('Unable to publish the states', err);
    }
  }

  /**
   * @description Give Gladys the new or corrected half-hours of an
   * electricity meter, at their real time.
   * @param {object} meter - The meter.
   * @param {Map<number, number|null>} slots - Slot start -> kWh.
   */
  async function publishHalfHours(meter, slots) {
    if (!gladys.connected || meter.commodity !== 'electricity' || !isCreated(meter)) return;
    const sent = state.get(meter.id, 'sent') ?? {};
    const fresh = [...slots]
      .filter(([start, kwh]) => kwh !== null && start + SLOT_MS <= now() && sent[start] !== kwh)
      .sort((a, b) => a[0] - b[0]);
    const feature = idsOf(gladys, meter.id).feature('consumption');
    for (let i = 0; i < fresh.length; i += MAX_INTERVALS) {
      const batch = fresh.slice(i, i + MAX_INTERVALS);
      try {
        await gladys.publishEnergyConsumption(
          feature,
          batch.map(([start, kwh]) => ({ starts_at: new Date(start).toISOString(), kwh })),
        );
        state.markSent(meter.id, batch, now());
      } catch (err) {
        // 404: the device is not created yet (or was deleted): published
        // again once it exists.
        logger.warn(`Unable to publish the half-hours of ${meter.id}: ${err.message}`);
        return;
      }
    }
  }

  /** @description Ask Gladys to fetch the widgets again (10 s apart at least). */
  function refreshWidgets() {
    if (!gladys.connected) return;
    Object.values(WIDGETS).forEach((key) => {
      const last = widgetRefreshedAt.get(key) ?? -Infinity;
      if (now() - last < WIDGET_REFRESH_GAP_MS) return;
      widgetRefreshedAt.set(key, now());
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.warn(`Unable to refresh the widget ${key}: ${err.message}`);
      }
    });
  }

  /**
   * @description The message of the current connection state.
   * @returns {{connected: boolean, message: object}|null} The status (null: unknown yet).
   */
  function statusMessage() {
    switch (connection) {
      case 'unconfigured':
        return { connected: false, message: all('statusUnconfigured') };
      case 'refused':
        return { connected: false, message: all('statusRefused') };
      case 'rate_limited':
        return {
          connected: true,
          message: all('statusRateLimited', {
            n: Math.max(1, Math.ceil((pausedUntil - now()) / MINUTE_MS)),
          }),
        };
      case 'error':
        return {
          connected: false,
          message: all('statusError', { error: connectionDetail ?? 'network' }),
        };
      case 'ok':
        if (meters.length === 0) return { connected: true, message: all('statusNoMeter') };
        return {
          connected: true,
          message: all((lang) =>
            t('statusOk', lang, {
              count: meters.length,
              list: meters.map((meter) => nameOf(meter, lang)).join(', '),
              minutes: config.refreshMinutes,
            }),
          ),
        };
      default:
        return null;
    }
  }

  /** @description Show the state of the connection in the Configuration screen. */
  async function reportStatus() {
    const status = statusMessage();
    if (!status || !gladys.connected) return;
    const signature = JSON.stringify(status);
    if (signature === lastStatus) return;
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(status.connected, status.message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the status', err);
    }
  }

  /**
   * @description Fire a scene event; a refusal is logged, never thrown.
   * @param {string} key - The trigger.
   * @param {object} data - Its data.
   */
  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  /** @description Compare each meter with its last snapshot, fire the transitions. */
  async function detect() {
    const events = [];
    const created = createdIds();
    for (const meter of meters) {
      const result = detectEvents(state.get(meter.id, 'snapshot') ?? null, modelOf(meter), {
        device: externalIdOf(meter),
        name: nameOf(meter),
        now: now(),
        timezone,
      });
      state.set(meter.id, 'snapshot', result.snapshot);
      if (created.has(externalIdOf(meter))) events.push(...result.events);
    }
    state.save();
    for (const event of events) await fire(event.key, event.data);
  }

  // --- Readings -----------------------------------------------------------------

  /** @description The meters of the account (and whether each has a power reading). */
  async function discover() {
    const entities = await api.getVirtualEntities();
    const homes = [];
    for (const ve of entities) {
      if (!ve?.veId) continue;
      homes.push({ ve, resources: await api.getResources(ve.veId) });
    }
    const found = parseMeters(homes);
    // An empty answer never wipes what is known.
    if (found.length > 0 || meters.length === 0) meters = found;
    if (found.length > 0) state.keep(found.map((meter) => meter.id));
    for (const meter of meters.filter((m) => m.commodity === 'electricity')) {
      const probe = state.get(meter.id, 'power');
      if (probe?.has || (probe && now() - probe.at < POWER_PROBE_EVERY_MS)) continue;
      await readPowerOf(meter, { probing: true });
    }
    due.discovery = now() + DISCOVERY_EVERY_MS;
    state.save();
  }

  /**
   * @description Read the power of a meter; while probing, an error means
   * "no power reading" (no Glow display).
   * @param {object} meter - The meter.
   * @param {object} [options] - Options.
   * @param {boolean} [options.probing] - First question to this meter.
   */
  async function readPowerOf(meter, { probing = false } = {}) {
    let reading = null;
    try {
      reading = parseCurrent(await api.getCurrent(meter.id), now());
    } catch (err) {
      if (err instanceof CredentialsError || err instanceof RateLimitError) throw err;
      if (!probing) logger.warn(`Power of ${meter.id}: ${err.message}`);
    }
    if (probing) {
      state.set(meter.id, 'power', { has: reading !== null, at: now() });
    }
    if (reading) power.set(meter.id, reading);
    else if (!probing) power.delete(meter.id);
  }

  /** @description The tariff of every meter. */
  async function readTariffs() {
    for (const meter of meters) {
      try {
        const tariff = parseTariff(await api.getTariff(meter.id));
        if (!tariff) continue;
        state.set(meter.id, 'tariff', tariff);
        const seen = state.get(meter.id, 'tariffSeen') ?? {};
        state.set(meter.id, 'tariffSeen', {
          rate: Boolean(seen.rate || tariff.rate !== null),
          standing: Boolean(seen.standing || tariff.standing !== null),
        });
      } catch (err) {
        if (err instanceof CredentialsError || err instanceof RateLimitError) throw err;
        // Some accounts have no tariff (Bright shows none): not an outage.
        logger.debug?.(`No tariff for ${meter.id}: ${err.message}`);
      }
    }
    due.tariff = now() + TARIFF_EVERY_MS;
    state.save();
  }

  /** @description Ask Hildebrand to fetch the latest half-hours from the DCC. */
  async function catchupAll() {
    if (config.catchup) {
      for (const meter of meters) {
        try {
          await api.catchup(meter.id);
        } catch (err) {
          if (err instanceof CredentialsError || err instanceof RateLimitError) throw err;
          logger.debug?.(`Catchup of ${meter.id}: ${err.message}`);
        }
      }
    }
    due.catchup = nextAfter(now(), periodMs(), CATCHUP_DELAY_MS) + random() * CATCHUP_JITTER_MS;
  }

  /**
   * @description Read the half-hours of a meter over a span of time starting
   * at a local midnight, and keep them: days, chart, latest, Gladys.
   * @param {object} meter - The meter.
   * @param {number} from - A local midnight (ms).
   * @param {number} to - End (ms).
   * @returns {Promise<void>} Done.
   */
  async function readSpan(meter, from, to) {
    for (const [start, end] of splitRange(from, to)) {
      const slots = parseReadings((await api.getReadings(meter.id, { from: start, to: end })).data);
      const days = {};
      for (const [date, day] of sumByDay(slots, timezone)) {
        // Only the days the span covers from their midnight.
        if (midnightOf(date, timezone) < from) continue;
        days[date] = {
          kwh: Math.round(day.total * 100000) / 100000,
          known: day.known,
          slots: slotsOfDay(date, timezone),
        };
      }
      if (meter.costId) {
        const costs = parseReadings(
          (await api.getReadings(meter.costId, { from: start, to: end })).data,
        );
        for (const [date, day] of sumByDay(costs, timezone)) {
          if (midnightOf(date, timezone) < from) continue;
          days[date] = { ...days[date], pence: Math.round(day.total * 1000) / 1000 };
        }
        state.mergeSlots(meter.id, 'costHalfHours', costs, now());
      }
      state.mergeDays(meter.id, days);
      state.mergeSlots(meter.id, 'halfHours', slots, now());
      const known = [...slots].filter(([, kwh]) => kwh !== null).map(([at]) => at);
      if (known.length > 0) {
        state.set(meter.id, 'latest', Math.max(state.get(meter.id, 'latest') ?? 0, ...known));
      }
      await publishHalfHours(meter, slots);
    }
  }

  /** @description Read yesterday and today of every meter (and any gap since). */
  async function readAll() {
    const today = dayOf(now(), timezone);
    for (const meter of meters) {
      let from = midnightOf(addDays(today, -1), timezone);
      const latest = state.get(meter.id, 'latest');
      if (Number.isFinite(latest) && latest < from) {
        // A gap (the integration was stopped, the DCC was silent): back to
        // the day of the last half-hour, 10 days at most.
        const oldest = midnightOf(addDays(today, -10), timezone);
        from = Math.max(oldest, midnightOf(dayOf(latest, timezone), timezone));
      }
      await readSpan(meter, from, Math.floor(now() / MINUTE_MS) * MINUTE_MS);
    }
    due.read = nextAfter(now(), periodMs(), READ_DELAY_MS) + random() * READ_JITTER_MS;
    lastSuccessAt = now();
    state.save();
  }

  /** @description The history of a meter, once (10 days per request). */
  async function backfill() {
    for (const meter of meters) {
      if (state.get(meter.id, 'backfilled')) continue;
      // Read once the meter is added (resetSent asks for it again when it is
      // added once more): never the history of a meter nobody uses.
      if (!isCreated(meter)) continue;
      if (config.historyDays > 0) {
        const today = dayOf(now(), timezone);
        const from = midnightOf(addDays(today, -config.historyDays), timezone);
        const to = midnightOf(addDays(today, -1), timezone);
        await readSpan(meter, from, to);
      }
      state.set(meter.id, 'backfilled', true);
      state.save();
    }
  }

  /** @description The power of the meters that have it. */
  async function readPower() {
    const list = meters.filter((meter) => modelOf(meter).hasPower);
    for (const meter of list) await readPowerOf(meter);
    due.power = now() + config.powerMinutes * MINUTE_MS;
  }

  /**
   * @description Record an API failure: refused credentials, slow-down or
   * unreachable API.
   * @param {Error} err - The error.
   */
  function handleError(err) {
    if (err instanceof CredentialsError) {
      connection = err.reason === 'MISSING' ? 'unconfigured' : 'refused';
      connectionDetail = err.reason;
      pausedUntil = now() + REFUSED_RETRY_MS;
      logger.warn(`Glowmarkt refused the credentials (${err.reason})`);
      return;
    }
    backoff += 1;
    if (err instanceof RateLimitError) {
      const pause = Math.min(
        MAX_RATE_LIMIT_PAUSE_MS,
        Math.max(err.retryAfterMs, err.retryAfterMs * 2 ** (backoff - 1)),
      );
      connection = 'rate_limited';
      pausedUntil = now() + pause;
      logger.warn(
        `Glowmarkt limits the requests: next try in ${Math.round(pause / MINUTE_MS)} min`,
      );
      return;
    }
    connection = 'error';
    connectionDetail = err instanceof ApiError ? `HTTP ${err.status}` : err.message?.slice(0, 80);
    pausedUntil = now() + Math.min(MAX_ERROR_RETRY_MS, ERROR_RETRY_MS * 2 ** (backoff - 1));
    logger.warn(`Glowmarkt reading failed: ${err.message}`);
  }

  /**
   * @description Do what is due (or everything when forced).
   * @param {object} [options] - Options.
   * @param {boolean} [options.force] - Read now: meters, tariffs, catchup, half-hours.
   * @returns {Promise<boolean>} The work went through.
   */
  function run({ force = false } = {}) {
    return exclusive(async () => {
      if (!api.hasCredentials()) {
        connection = 'unconfigured';
        await reportStatus();
        refreshWidgets();
        return false;
      }
      if (!force && now() < pausedUntil) return false;
      const at = now();
      const isDue = (key) => force || at >= due[key];
      const before = discoverySignature(gladys, meters.map(modelOf), textLanguage(), withHome());
      let readings = false;
      try {
        if (isDue('discovery')) await discover();
        if (isDue('tariff')) await readTariffs();
        if (isDue('catchup')) await catchupAll();
        if (isDue('read')) {
          await readAll();
          readings = true;
        }
        await backfill();
        if (isDue('power')) await readPower();
        connection = 'ok';
        connectionDetail = null;
        backoff = 0;
        pausedUntil = 0;
        return true;
      } catch (err) {
        handleError(err);
        return false;
      } finally {
        state.save();
        const after = discoverySignature(gladys, meters.map(modelOf), textLanguage(), withHome());
        if (after !== before || lastDiscovery === null) await publishDiscovery();
        await publishStates();
        if (readings || force) await detect();
        await reportStatus();
        refreshWidgets();
      }
    });
  }

  /** @description The clock. */
  async function tick() {
    if (!gladys.connected) return;
    await run();
  }

  /**
   * @description A manual reading (button, scene action): at most every
   * 5 minutes.
   * @returns {Promise<boolean|null>} The reading worked (null: too soon, the
   *   last one stands).
   */
  async function manualRead() {
    if (lastManualAt && now() - lastManualAt < MIN_MANUAL_GAP_MS && lastSuccessAt) return null;
    lastManualAt = now();
    return run({ force: true });
  }

  /**
   * @description The days of a period for a meter, read when the cache does
   * not hold them.
   * @param {object} meter - The meter.
   * @param {string} period - One of PERIODS.
   * @returns {Promise<object>} `{ energy_kwh, cost?, days, complete, from, to }`.
   */
  async function consumptionOf(meter, period) {
    const { from, to } = periodDates(period, now(), timezone);
    const dates = datesBetween(from, to);
    const cached = state.get(meter.id, 'days') ?? {};
    const missing = dates.some(
      (date) => !cached[date] || (meter.costId && cached[date].pence === undefined),
    );
    if (missing) {
      await exclusive(() =>
        readSpan(
          meter,
          midnightOf(from, timezone),
          Math.min(Math.floor(now() / MINUTE_MS) * MINUTE_MS, midnightOf(addDays(to, 1), timezone)),
        ),
      );
      state.save();
    }
    const days = state.get(meter.id, 'days') ?? {};
    let kwh = 0;
    let pence = 0;
    let complete = true;
    for (const date of dates) {
      const day = days[date];
      kwh += day?.kwh ?? 0;
      pence += day?.pence ?? 0;
      if (!day || day.known < day.slots) complete = false;
    }
    return {
      energy_kwh: Math.round(kwh * 1000) / 1000,
      ...(meter.costId ? { cost: Math.round(pence) / 100 } : {}),
      days: dates.length,
      complete,
      from,
      to,
    };
  }

  /**
   * @description The meter of a scene action or a widget: the one chosen, or
   * the electricity one (else the first).
   * @param {string} [externalId] - The Gladys external id (empty: default).
   * @returns {object|null} The meter.
   */
  function meterOf(externalId) {
    if (externalId) return byExternalId(externalId);
    return meters.find((meter) => meter.commodity === 'electricity') ?? meters[0] ?? null;
  }

  // --- Scene actions ----------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.GET_CONSUMPTION, async (fields = {}) => {
    const meter = meterOf(fields.device);
    if (!meter) throw new Error('No smart meter: read the meters again');
    return consumptionOf(meter, fields.period || DEFAULT_PERIOD);
  });

  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    const ok = await manualRead();
    if (ok === false) throw new Error(`Glowmarkt reading failed (${connection})`);
    const result = {};
    for (const meter of meters) {
      const model = modelOf(meter);
      if (`${meter.commodity}_today_kwh` in result) continue;
      result[`${meter.commodity}_today_kwh`] = Math.round((model.today?.kwh ?? 0) * 1000) / 1000;
      if (model.today?.pence !== null && model.today?.pence !== undefined) {
        result[`${meter.commodity}_today_cost`] = Math.round(model.today.pence) / 100;
      }
      if (Number.isFinite(model.latest)) {
        result[`${meter.commodity}_latest`] = new Date(model.latest + SLOT_MS).toISOString();
      }
    }
    return result;
  });

  // --- Configuration button ----------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!api.hasCredentials()) return all('statusUnconfigured');
    lastManualAt = now();
    const ok = await run({ force: true });
    if (!ok) return statusMessage()?.message ?? all('statusError', { error: 'network' });
    if (meters.length === 0) return all('statusNoMeter');
    return all((lang) => {
      const list = meters
        .map((meter) => {
          const model = modelOf(meter);
          return t('testMeter', lang, {
            name: nameOf(meter, lang),
            kwh: Math.round((model.today?.kwh ?? 0) * 100) / 100,
            time: Number.isFinite(model.latest)
              ? formatLatest(model.latest, now(), timezone, lang)
              : t('never', lang),
            features: featuresOf(model).length,
          });
        })
        .join(' · ');
      return t('testOk', lang, { count: meters.length, list }).slice(0, 2000);
    });
  });

  // --- Widgets ------------------------------------------------------------------------

  /**
   * @description Remember the language of the last widget request (the
   * device and feature names follow it when the configuration says "automatic").
   * @param {string} lang - The language of the request.
   */
  function rememberLanguage(lang) {
    if (!isLanguage(lang) || lang === language) return;
    const before = textLanguage();
    language = lang;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: lang })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
    if (textLanguage() !== before) publishDiscovery();
  }

  gladys.onWidgetGet(WIDGETS.METER, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const shown = isLanguage(lang) ? lang : textLanguage();
    const meter = meterOf(settings.device);
    return buildMeterWidget({
      meter: meter ? modelOf(meter) : null,
      name: meter ? shortNameOf(meter, shown) : '',
      range: Object.values(RANGES).includes(settings.range) ? settings.range : RANGES.DAY,
      connection,
      language: shown,
      timezone,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.STATUS, async ({ language: lang } = {}) => {
    rememberLanguage(lang);
    const shown = isLanguage(lang) ? lang : textLanguage();
    return buildStatusWidget({
      connection,
      meters: meters.map((meter) => ({ meter: modelOf(meter), name: shortNameOf(meter, shown) })),
      requests: api.requestsLastHour(),
      lastSuccessAt,
      pausedUntil,
      language: shown,
      timezone,
      now: now(),
    });
  });

  /**
   * @description The button of the widgets: read now.
   * @param {string} actionKey - The button.
   * @returns {Promise<object>} The toast.
   */
  async function widgetAction(actionKey) {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) throw new Error(`Unknown button ${actionKey}`);
    const ok = await manualRead();
    if (ok === null) {
      return all((lang) => t('toastTooSoon', lang, { ago: ago(lastSuccessAt, now(), lang) }));
    }
    if (!ok) {
      return all((lang) => t('toastFailed', lang, { error: t(`connection_${connection}`, lang) }));
    }
    return all('toastRefreshed', { n: meters.length });
  }
  gladys.onWidgetAction(WIDGETS.METER, widgetAction);
  gladys.onWidgetAction(WIDGETS.STATUS, widgetAction);

  // --- Devices and configuration --------------------------------------------------

  gladys.onScanRequest(async () => {
    due.discovery = 0;
    await run();
    await publishDiscovery({ force: true });
  });

  gladys.onDeviceCreated(async (device) => {
    const meter = byExternalId(device.external_id);
    if (meter) {
      // Everything is given to Gladys again: the half-hours already read now,
      // the history at the next tick.
      state.resetSent(meter.id);
      await publishStates([meter]);
      const halfHours = state.get(meter.id, 'halfHours') ?? {};
      await publishHalfHours(
        meter,
        new Map(Object.entries(halfHours).map(([start, kwh]) => [Number(start), kwh])),
      );
      state.save();
    }
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const meter = byExternalId(device.external_id);
    if (meter) await publishStates([meter]);
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = { ...config, language: textLanguage() };
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.username, config.password);
    const credentialsChanged =
      config.username !== previous.username || config.password !== previous.password;
    if (credentialsChanged) {
      connection = 'unknown';
      connectionDetail = null;
      pausedUntil = 0;
      backoff = 0;
      lastStatus = null;
      for (const key of Object.keys(due)) due[key] = 0;
    }
    if (config.refreshMinutes !== previous.refreshMinutes) due.read = 0;
    if (config.powerMinutes !== previous.powerMinutes) due.power = 0;
    if (textLanguage() !== previous.language) await publishDiscovery({ force: true });
    if (credentialsChanged) await run();
    else refreshWidgets();
  });

  gladys.on('connected', async () => {
    const raw = gladys.config ?? {};
    config = normalizeConfig(raw);
    language = readLanguage(raw, language);
    api.setCredentials(config.username, config.password);
    lastStatus = null;
    lastDiscovery = null;
    for (const key of Object.keys(due)) due[key] = 0;
    await run();
    if (tickMs > 0 && timer === null) {
      timer = setInterval(() => {
        tick().catch((err) => logger.error('Tick failed', err));
      }, tickMs);
      timer.unref?.();
    }
  });

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stop();
    await chain;
    state.save();
  });

  return {
    run,
    tick,
    stop,
    state,
    due,
    meters: () => meters,
    model: (id) => {
      const meter = meters.find((m) => m.id === id);
      return meter ? modelOf(meter) : null;
    },
    connection: () => connection,
    consumptionOf,
  };
}

export {
  ACTIONS,
  TICK_MS,
  READ_DELAY_MS,
  CATCHUP_DELAY_MS,
  MIN_MANUAL_GAP_MS,
  REFUSED_RETRY_MS,
  DAY_MS,
  TRIGGERS,
  nextAfter,
  createApp,
};

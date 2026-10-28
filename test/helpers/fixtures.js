// -----------------------------------------------------------------------------
// Made-up Glowmarkt answers, shaped like the official Swagger documents
// (https://api.glowmarkt.com/api-docs/v0-1/vesys/ and …/resourcesys/:
// `Ve`, `VeWithFullResources`, `readingRes`, `TariffResult`,
// `CurrentReadingsResult`, `catchupRes`) and like the answers the
// open-source clients parse (pyglowmarkt: `currentRates`). Never a real
// account: the integration has never been run against one.
// -----------------------------------------------------------------------------

import { createGlowApi } from '../../src/glow-api.js';

// Wednesday 28 October 2026, 14:20 in London (GMT, after the clock change).
const T0 = Date.parse('2026-10-28T14:20:00Z');
const SLOT = 30 * 60 * 1000;

const VE = {
  veId: 'f7a3c4b2-0001-4e5f-9a8b-112233445566',
  veTypeId: 'b4158501-a9a9-4b1e-8dc1-2a5b7d6e8f90',
  name: 'DCC Sourced',
  postalCode: 'SW1A 1AA',
  applicationId: 'b0f1b774-a586-4f72-9edd-27ead8aa7a8d',
  active: true,
  resources: [],
};

const ELEC = 'e1ec0000-1111-4222-8333-444455556666';
const ELEC_COST = 'e1ec0000-1111-4222-8333-c05700000001';
const GAS = '9a500000-1111-4222-8333-444455556666';
const GAS_COST = '9a500000-1111-4222-8333-c05700000002';

const resource = (resourceId, classifier, name, baseUnit) => ({
  resourceId,
  resourceTypeId: `type-${classifier}`,
  name,
  description: name,
  classifier,
  baseUnit,
  active: true,
  dataSourceType: 'DCC',
});

const RESOURCES = [
  resource(ELEC, 'electricity.consumption', 'electricity consumption', 'kWh'),
  resource(ELEC_COST, 'electricity.consumption.cost', 'electricity cost', 'pence'),
  resource(GAS, 'gas.consumption', 'gas consumption', 'kWh'),
  resource(GAS_COST, 'gas.consumption.cost', 'gas cost', 'pence'),
];

// The documented tariff shape (plan / planDetail), and the one pyglowmarkt reads.
const TARIFF_PLAN = [
  {
    plan: [{ planDetail: [{ rate: 24.5 }, { standing: 60.12 }] }],
    cid: 'PWER',
    commodity: 'ELEC',
    from: '2026-10-01 00:00:00',
    name: 'TariffFromMeter',
  },
];
const TARIFF_CURRENT_RATES = [
  {
    name: 'TariffFromMeter',
    commodity: 'GAS',
    cid: 'GAS',
    type: 'TOU',
    from: '2026-10-01 00:00:00',
    currentRates: { rate: '6.24', standingCharge: '31.65' },
  },
];
const RATES = { [ELEC]: 24.5, [GAS]: 6.24 };

/**
 * @description The kWh of a half-hour of a meter (a daily shape, reproducible).
 * @param {string} id - The consumption resource.
 * @param {number} start - Slot start (ms).
 * @returns {number} kWh.
 */
function kwhOf(id, start) {
  const hour = new Date(start).getUTCHours();
  const base = hour < 6 ? 0.12 : hour < 9 ? 0.45 : hour < 17 ? 0.25 : hour < 22 ? 0.6 : 0.2;
  const value = id === GAS ? base * 3 : base;
  return Math.round(value * 1000) / 1000;
}

/**
 * @description A fake Glowmarkt API (no network).
 * @param {object} [options] - Options.
 * @param {Function} options.clock - `() => now (ms)`.
 * @param {number} [options.delayMs] - How late the half-hours are (default 1 h).
 * @returns {object} The fake API, with `calls`, `failNext`, `current`, `tariffs`…
 */
function fakeApi({ clock, delayMs = 60 * 60 * 1000 } = {}) {
  const fake = {
    calls: [],
    credentials: null,
    failNext: null,
    delayMs,
    resources: JSON.parse(JSON.stringify(RESOURCES)),
    entities: [{ ...VE }],
    tariffs: { [ELEC]: TARIFF_PLAN, [GAS]: TARIFF_CURRENT_RATES },
    // resource id -> current answer (null: an error, like a meter without display)
    current: {},
    setCredentials(email, secret) {
      fake.credentials = email && secret ? { email, secret } : null;
    },
    hasCredentials: () => fake.credentials !== null,
    throwIfAsked(name) {
      if (fake.failNext && (!fake.failNext.on || fake.failNext.on === name)) {
        const { error } = fake.failNext;
        fake.failNext = null;
        throw error;
      }
    },
    async getVirtualEntities() {
      fake.calls.push('virtualentity');
      fake.throwIfAsked('virtualentity');
      return JSON.parse(JSON.stringify(fake.entities));
    },
    async getResources(veId) {
      fake.calls.push(`resources:${veId}`);
      fake.throwIfAsked('resources');
      return JSON.parse(JSON.stringify(fake.resources));
    },
    async getReadings(id, { from, to }) {
      fake.calls.push(`readings:${id}`);
      fake.throwIfAsked('readings');
      const consumption = id === ELEC_COST ? ELEC : id === GAS_COST ? GAS : id;
      const isCost = consumption !== id;
      const data = [];
      const until = clock() - fake.delayMs;
      for (let start = Math.ceil(from / SLOT) * SLOT; start < to; start += SLOT) {
        const known = start + SLOT <= until;
        const kwh = kwhOf(consumption, start);
        const value = isCost ? Math.round(kwh * RATES[consumption] * 1000) / 1000 : kwh;
        data.push([start / 1000, known ? value : null]);
      }
      return { units: isCost ? 'pence' : 'kWh', data };
    },
    async getCurrent(id) {
      fake.calls.push(`current:${id}`);
      fake.throwIfAsked('current');
      const answer = fake.current[id];
      if (!answer) throw Object.assign(new Error('Glowmarkt API error 500'), { status: 500 });
      return answer;
    },
    async getTariff(id) {
      fake.calls.push(`tariff:${id}`);
      fake.throwIfAsked('tariff');
      return JSON.parse(JSON.stringify(fake.tariffs[id] ?? []));
    },
    async catchup(id) {
      fake.calls.push(`catchup:${id}`);
      fake.throwIfAsked('catchup');
      return true;
    },
    async signIn() {
      fake.calls.push('auth');
    },
    requestsLastHour: () => fake.calls.length,
  };
  return fake;
}

/**
 * @description A fake `fetch` answering from a handler.
 * @param {Function} handler - `(url, init, n) => { status, body, headers? }`.
 * @returns {Function & { requests: object[] }} The fetch.
 */
function fakeFetch(handler) {
  const requests = [];
  const impl = async (url, init = {}) => {
    requests.push({ url, ...init });
    const answer = await handler(url, init, requests.length);
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    const headers = new Map(
      Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      status: answer.status ?? 200,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () => text,
    };
  };
  impl.requests = requests;
  return impl;
}

/**
 * @description A real API client on a fake fetch and a fake clock.
 * @param {Function} handler - The fetch handler.
 * @returns {{ api: object, fetch: Function, clock: object }} The client.
 */
function apiWithFetch(handler) {
  const clock = { now: 1_800_000_000_000, slept: [] };
  const fetchImpl = fakeFetch(handler);
  const api = createGlowApi({
    fetchImpl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.slept.push(ms);
      clock.now += ms;
    },
  });
  return { api, fetch: fetchImpl, clock };
}

// Ids of the fake Gladys (selector "test-integration").
const fakeGladys = {
  externalIds: (type, id) => {
    const device = `ext:test-integration:${type}:${id}`;
    return { device, feature: (key) => `${device}:${key}` };
  },
};

export {
  T0,
  SLOT,
  VE,
  ELEC,
  ELEC_COST,
  GAS,
  GAS_COST,
  RESOURCES,
  TARIFF_PLAN,
  TARIFF_CURRENT_RATES,
  kwhOf,
  fakeApi,
  fakeFetch,
  apiWithFetch,
  fakeGladys,
};

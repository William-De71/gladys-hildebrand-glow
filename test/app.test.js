// The whole integration against the fake Gladys of the SDK and a fake
// Glowmarkt API: discovery, states, dated half-hours, history, schedule
// (catchup, readings, tariffs, power), scene triggers and actions, widgets,
// errors, persistence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, REFUSED_RETRY_MS, MIN_MANUAL_GAP_MS } from '../src/app.js';
import { CredentialsError, RateLimitError } from '../src/glow-api.js';
import { T0, SLOT, ELEC, ELEC_COST, GAS, GAS_COST, fakeApi, kwhOf } from './helpers/fixtures.js';

const CONFIG = { username: 'me@example.co.uk', password: 'secret' };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ext = (id) => `ext:test-integration:meter:${id}`;
const feature = (id, key) => `${ext(id)}:${key}`;

/**
 * @description A connected integration on a fake clock (London).
 * @param {object} [options] - Options.
 * @returns {Promise<object>} The handles.
 */
async function start({
  config = CONFIG,
  statePath = null,
  created = true,
  devices = [],
  api,
} = {}) {
  const clock = { now: T0 };
  const fake = api ?? fakeApi({ clock: () => clock.now });
  const gladys = createFakeGladys({ config: { ...config }, devices });
  const app = createApp(gladys, {
    api: fake,
    now: () => clock.now,
    random: () => 0,
    statePath,
    tickMs: 0,
    timezone: 'Europe/London',
  });
  await gladys.connect();
  if (created && devices.length === 0) {
    for (const device of gladys.fake.discoveredDevices) await gladys.fake.deviceCreated(device);
  }
  const advance = async (ms) => {
    clock.now += ms;
    await app.tick();
  };
  const state = (id, key) => gladys.fake.lastState(feature(id, key));
  const halfHours = () => gladys.fake.energyConsumption[feature(ELEC, 'consumption')] ?? [];
  return { gladys, app, api: fake, clock, advance, state, halfHours };
}

test('without credentials: nothing is requested, the configuration says what to do', async () => {
  const { gladys, api } = await start({ config: {} });
  assert.deepEqual(api.calls, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Bright account/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('first run: meters, power probe, tariffs, catchup, then yesterday and today', async () => {
  const { gladys, api } = await start({ created: false });
  assert.deepEqual(api.calls, [
    'virtualentity',
    'resources:f7a3c4b2-0001-4e5f-9a8b-112233445566',
    `current:${ELEC}`,
    `tariff:${ELEC}`,
    `tariff:${GAS}`,
    `catchup:${ELEC}`,
    `catchup:${GAS}`,
    `readings:${ELEC}`,
    `readings:${ELEC_COST}`,
    `readings:${GAS}`,
    `readings:${GAS_COST}`,
  ]);
  const [elec, gas] = gladys.fake.discoveredDevices;
  assert.equal(elec.name, 'Electricity meter');
  assert.equal(gas.name, 'Gas meter');
  assert.deepEqual(
    elec.features.map((f) => f.external_id.split(':').pop()),
    [
      'consumption',
      'energy_today',
      'energy_yesterday',
      'cost_today',
      'cost_yesterday',
      'unit_rate',
      'standing_charge',
    ],
    'no power: the meter has no Glow display',
  );
  assert.equal(gas.features.length, 6);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /2 smart meter\(s\): Electricity meter, Gas meter/,
  );
  // Nothing published for meters the user has not added.
  assert.deepEqual(gladys.fake.states, []);
  assert.deepEqual(gladys.fake.publishedEnergyConsumption, []);
});

test('an added meter: its states, and every half-hour at its real time', async () => {
  const { state, halfHours, gladys } = await start();
  // 14:20, data one hour late: the last half-hour is 12:30-13:00 (13:00 to 13:20 not elapsed in the fake).
  const yesterday = Array.from({ length: 48 }, (_, i) =>
    kwhOf(ELEC, Date.parse('2026-10-27T00:00:00Z') + i * SLOT),
  ).reduce((a, b) => a + b, 0);
  assert.equal(state(ELEC, 'energy_yesterday'), Math.round(yesterday * 1000) / 1000);
  assert.equal(state(ELEC, 'cost_yesterday'), Math.round(yesterday * 24.5) / 100);
  assert.equal(state(ELEC, 'unit_rate'), 0.245);
  assert.equal(state(ELEC, 'standing_charge'), 0.6012);
  assert.equal(state(GAS, 'unit_rate'), 0.0624);
  assert.ok(state(ELEC, 'energy_today') > 0);
  const slots = halfHours();
  // Yesterday (48) + today up to 13:00 (26), dated at the END of each slot.
  assert.equal(slots.length, 48 + 26);
  assert.equal(slots[0].created_at, '2026-10-27T00:30:00.000Z');
  assert.equal(slots.at(-1).created_at, '2026-10-28T13:00:00.000Z');
  // Gas never goes through the consumption pipeline.
  assert.equal(gladys.fake.energyConsumption[feature(GAS, 'consumption')], undefined);
});

test('history: once the meter is added, 31 days, 10 days per request', async () => {
  const { api, advance, halfHours } = await start();
  api.calls.length = 0;
  await advance(1000);
  const history = api.calls.filter((call) => call === `readings:${ELEC}`);
  assert.equal(history.length, 4, '31 days in 4 requests');
  assert.equal(api.calls.filter((call) => call === `readings:${GAS}`).length, 4);
  // 30 more days of half-hours (from 28/09 to 26/10, the 25th has 50: the
  // clock change), on top of yesterday and today.
  assert.equal(halfHours().length, 48 + 26 + 30 * 48 + 2);
  api.calls.length = 0;
  await advance(1000);
  assert.deepEqual(api.calls, [], 'only once');
});

test('the clock: catchup just after the half-hour, the reading 10 minutes after it', async () => {
  const { api, advance, halfHours } = await start();
  await advance(1000);
  api.calls.length = 0;
  // 14:31: the catchup (1 min after 14:30).
  await advance(11 * MINUTE);
  assert.deepEqual(api.calls, [`catchup:${ELEC}`, `catchup:${GAS}`]);
  // 14:41: the reading; the new half-hour (13:00-13:30) is published alone.
  const before = halfHours().length;
  api.calls.length = 0;
  await advance(10 * MINUTE);
  assert.deepEqual(api.calls, [
    `readings:${ELEC}`,
    `readings:${ELEC_COST}`,
    `readings:${GAS}`,
    `readings:${GAS_COST}`,
  ]);
  assert.equal(halfHours().length, before + 1);
  // 6 hours later: meters and tariffs again.
  api.calls.length = 0;
  await advance(6 * HOUR);
  assert.ok(api.calls.includes('virtualentity'));
  assert.ok(api.calls.includes(`tariff:${ELEC}`));
});

test('catchup can be turned off', async () => {
  const { api, gladys, advance } = await start();
  await gladys.fake.configUpdated({ ...CONFIG, catchup: false });
  api.calls.length = 0;
  await advance(30 * MINUTE);
  assert.ok(!api.calls.some((call) => call.startsWith('catchup')));
  assert.ok(api.calls.some((call) => call.startsWith('readings')));
});

test('only new or corrected half-hours are published again', async () => {
  const { gladys, halfHours, advance } = await start();
  await advance(1000);
  const batches = gladys.fake.publishedEnergyConsumption.length;
  // A reading with nothing new publishes nothing.
  await advance(40 * MINUTE);
  const added = gladys.fake.publishedEnergyConsumption.slice(batches);
  assert.ok(added.every((batch) => batch.intervals.length <= 2));
  const count = halfHours().length;
  await gladys.fake.sceneAction('refresh');
  assert.equal(halfHours().length, count);
});

test('a Glow display: the power feature, read every 2 minutes', async () => {
  const clock = { now: T0 };
  const api = fakeApi({ clock: () => clock.now });
  api.current[ELEC] = { units: 'W', data: [[T0 / 1000 - 10, 845]] };
  const gladys = createFakeGladys({ config: { ...CONFIG } });
  const app = createApp(gladys, {
    api,
    now: () => clock.now,
    random: () => 0,
    statePath: null,
    tickMs: 0,
    timezone: 'Europe/London',
  });
  await gladys.connect();
  const [elec] = gladys.fake.discoveredDevices;
  assert.equal(elec.features.at(-1).external_id, feature(ELEC, 'power'));
  await gladys.fake.deviceCreated(elec);
  assert.equal(gladys.fake.lastState(feature(ELEC, 'power')), 845);
  api.current[ELEC] = { units: 'W', data: [[(T0 + 2 * MINUTE) / 1000, 1210]] };
  api.calls.length = 0;
  clock.now += 2 * MINUTE;
  await app.tick();
  assert.ok(api.calls.includes(`current:${ELEC}`));
  assert.equal(gladys.fake.lastState(feature(ELEC, 'power')), 1210);
  assert.ok(!api.calls.includes(`current:${GAS}`), 'never asked for gas');
});

test('refused credentials: shown, tried again after 30 minutes or new credentials', async () => {
  const clock = { now: T0 };
  const api = fakeApi({ clock: () => clock.now });
  api.failNext = { error: new CredentialsError('INVALID', 401) };
  const gladys = createFakeGladys({ config: { ...CONFIG } });
  const app = createApp(gladys, {
    api,
    now: () => clock.now,
    random: () => 0,
    statePath: null,
    tickMs: 0,
    timezone: 'Europe/London',
  });
  await gladys.connect();
  assert.equal(app.connection(), 'refused');
  assert.match(gladys.fake.connectionStatus.message.fr, /refuse la connexion/);
  api.calls.length = 0;
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.deepEqual(api.calls, [], 'paused');
  clock.now += REFUSED_RETRY_MS;
  await app.tick();
  assert.equal(app.connection(), 'ok');
  // New credentials are tried at once, without waiting for the pause.
  api.failNext = { error: new CredentialsError('INVALID', 401) };
  await gladys.fake.configUpdated({ ...CONFIG, password: 'wrong' });
  assert.equal(app.connection(), 'refused');
  await gladys.fake.configUpdated({ ...CONFIG, password: 'other' });
  assert.equal(app.connection(), 'ok');
});

test('429 and outages slow down; nothing is lost', async () => {
  const { app, api, advance } = await start();
  await advance(1000);
  api.failNext = { error: new RateLimitError(15 * MINUTE), on: 'readings' };
  await advance(40 * MINUTE);
  assert.equal(app.connection(), 'rate_limited');
  api.calls.length = 0;
  await advance(5 * MINUTE);
  assert.deepEqual(api.calls, []);
  await advance(15 * MINUTE);
  assert.equal(app.connection(), 'ok');
  assert.ok(api.calls.some((call) => call.startsWith('readings')));
  api.failNext = { error: new Error('Glowmarkt API error 503'), on: 'readings' };
  await advance(30 * MINUTE);
  assert.equal(app.connection(), 'error');
  await advance(6 * MINUTE);
  assert.equal(app.connection(), 'ok');
});

test('scene triggers: tariff change, data delayed then resumed, yesterday summarized', async () => {
  const { gladys, api, advance } = await start();
  await advance(1000);
  api.tariffs[ELEC] = [
    { from: '2026-10-28 00:00:00', currentRates: { rate: 26.35, standingCharge: 60.12 } },
  ];
  await advance(6 * HOUR);
  const tariff = gladys.fake.sceneEvents.find((e) => e.key === 'tariff_changed');
  assert.equal(tariff.data.device, ext(ELEC));
  assert.equal(tariff.data.unit_rate, 0.2635);
  assert.equal(tariff.data.previous_unit_rate, 0.245);
  // The DCC goes silent.
  api.delayMs = 400 * 24 * HOUR;
  await advance(12 * HOUR);
  const delayed = gladys.fake.sceneEvents.filter((e) => e.key === 'data_delayed');
  assert.deepEqual(
    delayed.map((e) => e.data.device),
    [ext(ELEC), ext(GAS)],
  );
  api.delayMs = HOUR;
  await advance(30 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === 'data_resumed').length, 2);
  // Next day (29/10): the 28th is complete -> summarized, once per meter.
  const summaries = gladys.fake.sceneEvents.filter((e) => e.key === 'daily_summary');
  assert.deepEqual(
    summaries.map((e) => [e.data.device, e.data.date, e.data.complete]),
    [
      [ext(ELEC), '2026-10-28', true],
      [ext(GAS), '2026-10-28', true],
    ],
  );
  assert.ok(summaries[0].data.cost > 0);
});

test('scene actions: energy of a period (from what is known, or read), read now', async () => {
  const { gladys, api, advance } = await start();
  await advance(1000);
  api.calls.length = 0;
  const yesterday = await gladys.fake.sceneAction('get_consumption', { period: 'yesterday' });
  assert.deepEqual(api.calls, [], 'already known');
  assert.equal(yesterday.success, true, JSON.stringify(yesterday));
  const outputs = yesterday.data.outputs;
  assert.deepEqual(Object.keys(outputs).sort(), [
    'complete',
    'cost',
    'days',
    'energy_kwh',
    'from',
    'to',
  ]);
  assert.equal(outputs.from, '2026-10-27');
  assert.equal(outputs.complete, true);
  const gas = await gladys.fake.sceneAction('get_consumption', {
    device: ext(GAS),
    period: 'last_month',
  });
  assert.equal(gas.data.outputs.days, 30);
  assert.ok(api.calls.includes(`readings:${GAS}`), 'September is read');
  const now = await gladys.fake.sceneAction('refresh');
  assert.equal(now.success, true);
  assert.deepEqual(Object.keys(now.data.outputs).sort(), [
    'electricity_latest',
    'electricity_today_cost',
    'electricity_today_kwh',
    'gas_latest',
    'gas_today_cost',
    'gas_today_kwh',
  ]);
  assert.equal(now.data.outputs.electricity_latest, '2026-10-28T13:00:00.000Z');
});

test('widgets: valid contents, the meter by default, buttons', async () => {
  const { gladys, clock } = await start();
  for (const [key, settings] of [
    ['meter', {}],
    ['meter', { device: ext(GAS), range: 'month' }],
    ['meter', { range: 'week' }],
    ['status', {}],
  ]) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const answer = await gladys.fake.widgetGet(key, { settings, language });
      assert.equal(answer.success, true, `${key} ${language}`);
      assert.deepEqual(validateWidgetContent(answer.data.content), [], `${key} ${language}`);
    }
  }
  const meter = (await gladys.fake.widgetGet('meter', { settings: {}, language: 'en' })).data
    .content;
  assert.equal(meter.components[0].label, 'Today');
  assert.match(
    meter.components.find((c) => c.variant === 'caption').text,
    /^Electricity · data up to 13:00/,
  );
  const toast = await gladys.fake.widgetAction('meter', 'refresh', {}, { settings: {} });
  assert.match(toast.data.message.en, /2 meter\(s\) read/);
  const soon = await gladys.fake.widgetAction('meter', 'refresh', {}, { settings: {} });
  assert.match(soon.data.message.en, /^Already read just now/);
  clock.now += MIN_MANUAL_GAP_MS + 1000;
  const again = await gladys.fake.widgetAction('status', 'refresh', {}, { settings: {} });
  assert.match(again.data.message.fr, /2 compteur\(s\) relevé\(s\)/);
});

test('the Test button lists the meters', async () => {
  const { gladys } = await start();
  const answer = await gladys.fake.action('test_connection');
  assert.equal(answer.success, true);
  assert.match(
    answer.data.message.en,
    /^Connected\. 2 smart meter\(s\): Electricity meter \(today [\d.]+ kWh, data up to 13:00, 7 features\)/,
  );
  assert.match(answer.data.message.fr, /Compteur de gaz/);
});

test('state file: 0600, kept across a restart (nothing published twice, no event fired twice)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glow-'));
  const statePath = join(dir, 'state.json');
  const first = await start({ statePath });
  await first.advance(1000);
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.ok(saved.meters[ELEC].sent);
  assert.doesNotMatch(readFileSync(statePath, 'utf8'), /secret|example\.co\.uk/);
  const devices = first.gladys.fake.devices;
  const second = await start({ statePath, devices });
  assert.deepEqual(second.gladys.fake.publishedEnergyConsumption, [], 'already in Gladys');
  assert.deepEqual(second.gladys.fake.sceneEvents, []);
  assert.ok(
    !second.api.calls.slice(11).some((call) => call === `readings:${ELEC}`),
    'no history again',
  );
});

test('the device created again: everything is published again', async () => {
  const { gladys, halfHours } = await start();
  const elec = gladys.fake.devices.find((d) => d.external_id === ext(ELEC));
  gladys.fake.energyConsumption[feature(ELEC, 'consumption')] = [];
  await gladys.fake.deviceCreated(elec);
  assert.equal(halfHours().length, 48 + 26);
});

test('shutdown saves the state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glow-'));
  const statePath = join(dir, 'state.json');
  const { gladys } = await start({ statePath });
  await gladys.fake.shutdown('SIGTERM');
  assert.ok(JSON.parse(readFileSync(statePath, 'utf8')).meters[GAS_COST] === undefined);
});

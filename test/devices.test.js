// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): every feature needs min / max /
// read_only / has_feedback, a wrong category / type pair shows no icon nor
// label, a unit outside its category is refused, and a single invalid field
// rejects the whole discovery batch. Plus the energy rules of the core 5.3.0:
// an `energy` or `index` type is a cumulative index (never here), and every
// consumption is attached to the main ELECTRIC meter (never gas).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { parseMeters } from '../src/glow.js';
import { buildDevice, buildStates, FEATURE_KEYS } from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';
import { VE, RESOURCES, ELEC, fakeGladys } from './helpers/fixtures.js';

const [elecMeter, gasMeter] = parseMeters([{ ve: VE, resources: RESOURCES }]);
const full = (meter, extra = {}) => ({
  ...meter,
  today: { kwh: 5.4321, pence: 133.08 },
  yesterday: { kwh: 9.87, pence: 241.8 },
  tariff:
    meter.commodity === 'gas' ? { rate: 6.24, standing: 31.65 } : { rate: 24.5, standing: 60.12 },
  hasRate: true,
  hasStanding: true,
  hasPower: true,
  power: { watts: 812, at: 0 },
  ...extra,
});
const ELEC_MODEL = full(elecMeter);
const GAS_MODEL = full(gasMeter);
const devices = (language) =>
  [ELEC_MODEL, GAS_MODEL].map((m) => buildDevice(fakeGladys, m, language));
const keysOf = (model) =>
  buildDevice(fakeGladys, model).features.map((f) => f.external_id.split(':').pop());
const statesOf = (model) =>
  Object.fromEntries(
    buildStates(fakeGladys, model).map((s) => [
      s.device_feature_external_id.split(':').pop(),
      s.state,
    ]),
  );

// DEVICE_FEATURE_UNITS_BY_CATEGORY of the Gladys core 5.3.0 (server/utils/constants.js).
const UNITS_OF = {
  [CATEGORIES.ENERGY_SENSOR]: [UNITS.WATT, UNITS.KILOWATT_HOUR],
  [CATEGORIES.CURRENCY]: [UNITS.POUND_STERLING],
};
// The pairs the front labels (front/src/config/i18n: deviceFeatureCategory.<category>.<type>).
const PAIRS = [
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION],
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.INDEX_TODAY],
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.INDEX_YESTERDAY],
  [CATEGORIES.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.POWER],
  [CATEGORIES.CURRENCY, TYPES.CURRENCY.DECIMAL],
];

test('meters are never polled by Gladys: the integration has its own clock', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature is read-only and carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) assert.equal(typeof feature[key], 'number');
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(feature.read_only, true, feature.external_id);
        assert.equal(feature.has_feedback, false, feature.external_id);
        assert.ok(feature.name, feature.external_id);
        for (const field of ['present', 'value', 'key']) assert.equal(feature[field], undefined);
      }
    }
  }
});

test('every category / type pair is a known one, every unit belongs to its category', () => {
  for (const device of devices('en')) {
    for (const feature of device.features) {
      assert.ok(
        PAIRS.some(([category, type]) => feature.category === category && feature.type === type),
        `${feature.external_id}: ${feature.category} / ${feature.type}`,
      );
      assert.ok(UNITS_OF[feature.category].includes(feature.unit), feature.external_id);
    }
  }
});

test('no cumulative index; a 30-minute consumption on the electricity meter only', () => {
  for (const device of devices('en')) {
    for (const feature of device.features) {
      // energy-sensor / energy and / index are the index pipeline of the core.
      assert.ok(![TYPES.ENERGY_SENSOR.INDEX, TYPES.ENERGY_SENSOR.ENERGY].includes(feature.type));
    }
  }
  const consumption = (device) =>
    device.features.filter((f) =>
      [
        TYPES.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
        TYPES.ENERGY_SENSOR.DAILY_CONSUMPTION,
      ].includes(f.type),
    );
  const [elec, gas] = devices('en');
  assert.equal(consumption(elec).length, 1);
  assert.equal(consumption(gas).length, 0, 'gas would be added to the electricity');
});

test('the features of each meter, and what makes them appear', () => {
  assert.deepEqual(keysOf(ELEC_MODEL), FEATURE_KEYS);
  assert.deepEqual(keysOf(GAS_MODEL), [
    'energy_today',
    'energy_yesterday',
    'cost_today',
    'cost_yesterday',
    'unit_rate',
    'standing_charge',
  ]);
  const bare = full(elecMeter, {
    costId: null,
    hasRate: false,
    hasStanding: false,
    hasPower: false,
  });
  assert.deepEqual(keysOf(bare), ['consumption', 'energy_today', 'energy_yesterday']);
  for (const key of FEATURE_KEYS) assert.match(key, /^[a-z_]+$/);
});

test('the states: kWh, pounds from pence, never the consumption (dated half-hours)', () => {
  assert.deepEqual(statesOf(ELEC_MODEL), {
    energy_today: 5.432,
    energy_yesterday: 9.87,
    cost_today: 1.33,
    cost_yesterday: 2.42,
    unit_rate: 0.245,
    standing_charge: 0.6012,
    power: 812,
  });
  const unknown = statesOf(full(elecMeter, { today: null, tariff: null, power: null }));
  assert.deepEqual(Object.keys(unknown), ['energy_yesterday', 'cost_yesterday']);
});

test('external ids come from the Glowmarkt resource id, never from a name', () => {
  const device = buildDevice(fakeGladys, ELEC_MODEL, 'fr');
  assert.equal(device.external_id, `ext:test-integration:meter:${ELEC}`);
  assert.equal(device.name, 'Compteur d’électricité');
  const renamed = buildDevice(fakeGladys, { ...ELEC_MODEL, veName: 'Home' }, 'fr', true);
  assert.equal(renamed.name, 'Compteur d’électricité (Home)');
  assert.deepEqual(
    renamed.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
  assert.deepEqual(device.params, [
    { name: 'GLOW_COMMODITY', value: 'electricity' },
    { name: 'GLOW_HOME', value: 'DCC Sourced' },
  ]);
});

test('the whole Discovery batch and the states are accepted by the fake Gladys', async () => {
  for (const language of LANGUAGES) {
    const gladys = createFakeGladys();
    await gladys.connect();
    await gladys.publishDiscoveredDevices(
      [ELEC_MODEL, GAS_MODEL].map((model) => buildDevice(gladys, model, language)),
    );
    assert.equal(gladys.fake.discoveredDevices.length, 2);
    await gladys.publishStates([ELEC_MODEL, GAS_MODEL].flatMap((m) => buildStates(gladys, m)));
    assert.equal(gladys.fake.requests.filter((r) => r.status >= 400).length, 0);
    await gladys.disconnect();
  }
});

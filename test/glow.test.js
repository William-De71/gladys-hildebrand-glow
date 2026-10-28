import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMeters,
  dayOf,
  midnightOf,
  addDays,
  slotsOfDay,
  parseReadings,
  sumByDay,
  splitRange,
  parseTariff,
  parseCurrent,
  DAY_MS,
} from '../src/glow.js';
import {
  VE,
  RESOURCES,
  ELEC,
  ELEC_COST,
  GAS,
  GAS_COST,
  TARIFF_PLAN,
  TARIFF_CURRENT_RATES,
} from './helpers/fixtures.js';

test('one meter per commodity and home, with its cost resource; electricity first', () => {
  const meters = parseMeters([{ ve: VE, resources: [...RESOURCES].reverse() }]);
  assert.deepEqual(meters, [
    { id: ELEC, commodity: 'electricity', veId: VE.veId, veName: 'DCC Sourced', costId: ELEC_COST },
    { id: GAS, commodity: 'gas', veId: VE.veId, veName: 'DCC Sourced', costId: GAS_COST },
  ]);
  // No cost resource, an unknown classifier, a cost without consumption.
  const partial = parseMeters([
    {
      ve: VE,
      resources: [
        { resourceId: 'r1', classifier: 'electricity.consumption' },
        { resourceId: 'r2', classifier: 'gas.consumption.cost' },
        { resourceId: 'r3', classifier: 'temperature' },
      ],
    },
    { ve: {}, resources: RESOURCES },
  ]);
  assert.deepEqual(
    partial.map((m) => [m.id, m.costId]),
    [['r1', null]],
  );
});

test('local days of London, clock changes included', () => {
  const zone = 'Europe/London';
  assert.equal(midnightOf('2026-10-28', zone), Date.parse('2026-10-28T00:00:00Z'));
  assert.equal(midnightOf('2026-07-01', zone), Date.parse('2026-06-30T23:00:00Z'));
  assert.equal(dayOf(Date.parse('2026-06-30T23:30:00Z'), zone), '2026-07-01');
  assert.equal(slotsOfDay('2026-10-25', zone), 50, 'the autumn clock change');
  assert.equal(slotsOfDay('2026-03-29', zone), 46, 'the spring clock change');
  assert.equal(slotsOfDay('2026-10-28', zone), 48);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(midnightOf('2026-10-28', 'Europe/Paris'), Date.parse('2026-10-27T23:00:00Z'));
});

test('readings: null is "not yet", a negative or broken value too; days summed', () => {
  const t0 = Date.parse('2026-10-27T23:00:00Z') / 1000;
  const slots = parseReadings([
    [t0, 0.5],
    [t0 + 1800, null],
    [t0 + 3600, '0.25'],
    [t0 + 5400, -1],
    ['x', 1],
    'junk',
  ]);
  assert.deepEqual([...slots.values()], [0.5, null, 0.25, null]);
  const days = sumByDay(slots, 'Europe/London');
  assert.deepEqual(Object.fromEntries(days), {
    '2026-10-27': { total: 0.5, known: 1 },
    '2026-10-28': { total: 0.25, known: 1 },
  });
});

test('spans longer than 10 days are cut for PT30M', () => {
  const from = Date.parse('2026-08-01T00:00:00Z');
  const ranges = splitRange(from, from + 31 * DAY_MS);
  assert.equal(ranges.length, 4);
  assert.deepEqual(ranges[0], [from, from + 10 * DAY_MS]);
  assert.equal(ranges.at(-1)[1], from + 31 * DAY_MS);
  assert.deepEqual(splitRange(from, from), []);
});

test('tariff: the documented plan shape and the currentRates shape, in pence', () => {
  assert.deepEqual(parseTariff(TARIFF_PLAN), { rate: 24.5, standing: 60.12 });
  assert.deepEqual(parseTariff(TARIFF_CURRENT_RATES), { rate: 6.24, standing: 31.65 });
  assert.equal(parseTariff([]), null);
  assert.equal(parseTariff([{ name: 'nothing' }]), null);
  // The latest of several.
  assert.deepEqual(
    parseTariff([
      { from: '2026-01-01 00:00:00', currentRates: { rate: 20, standingCharge: 50 } },
      { from: '2026-10-01 00:00:00', currentRates: { rate: 25, standingCharge: 55 } },
    ]),
    { rate: 25, standing: 55 },
  );
});

test('current: a recent reading in W (or kW), else nothing', () => {
  const now = Date.parse('2026-10-28T14:20:00Z');
  const at = now / 1000 - 30;
  assert.deepEqual(parseCurrent({ units: 'W', data: [[at, 812]] }, now), {
    watts: 812,
    at: at * 1000,
  });
  assert.equal(parseCurrent({ units: 'kW', data: [[at, 1.2]] }, now).watts, 1200);
  assert.equal(parseCurrent({ units: 'W', data: [] }, now), null, 'no Glow display');
  assert.equal(parseCurrent({ units: 'W', data: [[at - 3600, 500]] }, now), null, 'too old');
  assert.equal(parseCurrent({ units: 'kWh', data: [[at, 1]] }, now), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIGGERS,
  detectEvents,
  periodDates,
  datesBetween,
  delayHours,
  PERIODS,
} from '../src/events.js';

const TZ = 'Europe/London';
const NOW = Date.parse('2026-10-28T09:20:00Z');
const NOON = Date.parse('2026-10-28T12:20:00Z');
const context = (now = NOW) => ({
  device: 'ext:x:meter:1',
  name: 'Electricity meter',
  now,
  timezone: TZ,
});
const meter = (extra = {}) => ({
  commodity: 'electricity',
  days: { '2026-10-27': { kwh: 9.876, known: 48, slots: 48, pence: 241.8 } },
  latest: Date.parse('2026-10-28T08:00:00Z'),
  tariff: { rate: 24.5, standing: 60.12 },
  ...extra,
});
const keys = (result) => result.events.map((event) => event.key);

test('the first reading only sets the baseline', () => {
  const { events, snapshot } = detectEvents(null, meter(), context());
  assert.deepEqual(events, []);
  assert.deepEqual(snapshot, {
    summarized: '2026-10-27',
    delayed: false,
    rate: 24.5,
    standing: 60.12,
  });
});

test('daily_summary: once, when yesterday is complete', () => {
  const before = { summarized: '2026-10-26', delayed: false, rate: 24.5, standing: 60.12 };
  const result = detectEvents(before, meter(), context());
  assert.deepEqual(keys(result), [TRIGGERS.DAILY_SUMMARY]);
  assert.deepEqual(result.events[0].data, {
    device: 'ext:x:meter:1',
    device_name: 'Electricity meter',
    commodity: 'electricity',
    date: '2026-10-27',
    energy_kwh: 9.876,
    cost: 2.42,
    complete: true,
  });
  assert.deepEqual(keys(detectEvents(result.snapshot, meter(), context())), [], 'only once');
});

test('daily_summary: an incomplete yesterday waits until noon, then fires as incomplete', () => {
  const before = { summarized: '2026-10-26', delayed: false, rate: 24.5, standing: 60.12 };
  const partial = meter({ days: { '2026-10-27': { kwh: 7, known: 40, slots: 48 } } });
  assert.deepEqual(keys(detectEvents(before, partial, context())), []);
  const late = detectEvents(before, partial, context(NOON));
  assert.deepEqual(keys(late), [TRIGGERS.DAILY_SUMMARY]);
  assert.equal(late.events[0].data.complete, false);
  assert.equal(late.events[0].data.cost, null, 'no cost resource read');
});

test('tariff_changed: the new and the previous unit rate and standing charge, in pounds', () => {
  const before = { summarized: '2026-10-27', delayed: false, rate: 24.5, standing: 60.12 };
  const result = detectEvents(
    before,
    meter({ tariff: { rate: 26.35, standing: 60.12 } }),
    context(),
  );
  assert.deepEqual(keys(result), [TRIGGERS.TARIFF_CHANGED]);
  assert.deepEqual(
    [
      result.events[0].data.unit_rate,
      result.events[0].data.previous_unit_rate,
      result.events[0].data.standing_charge,
      result.events[0].data.previous_standing_charge,
    ],
    [0.2635, 0.245, 0.6012, 0.6012],
  );
  // A tariff missing from one reading does not fire.
  assert.deepEqual(keys(detectEvents(before, meter({ tariff: null }), context())), []);
});

test('data_delayed after 12 hours without a new half-hour, data_resumed when they come back', () => {
  const before = { summarized: '2026-10-27', delayed: false, rate: 24.5, standing: 60.12 };
  const stale = meter({ latest: Date.parse('2026-10-27T20:00:00Z') });
  const delayed = detectEvents(before, stale, context());
  assert.deepEqual(keys(delayed), [TRIGGERS.DATA_DELAYED]);
  assert.equal(delayed.events[0].data.hours, 12);
  assert.equal(delayed.events[0].data.latest, '2026-10-27T20:30:00.000Z');
  assert.deepEqual(keys(detectEvents(delayed.snapshot, stale, context())), []);
  const resumed = detectEvents(delayed.snapshot, meter(), context());
  assert.deepEqual(keys(resumed), [TRIGGERS.DATA_RESUMED]);
  assert.equal(delayHours(null, NOW), null);
});

test('event data are flat scalars, 30 keys at most', () => {
  const before = { summarized: '2026-10-26', delayed: false, rate: 20, standing: 50 };
  const result = detectEvents(
    before,
    meter({ latest: Date.parse('2026-10-27T10:00:00Z') }),
    context(),
  );
  assert.equal(result.events.length, 3);
  for (const { data } of result.events) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('periods: local dates, weeks from Monday, last month', () => {
  assert.deepEqual(periodDates('today', NOW, TZ), { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual(periodDates('yesterday', NOW, TZ), { from: '2026-10-27', to: '2026-10-27' });
  assert.deepEqual(periodDates('this_week', NOW, TZ), { from: '2026-10-26', to: '2026-10-28' });
  assert.deepEqual(periodDates('last_7_days', NOW, TZ), { from: '2026-10-21', to: '2026-10-27' });
  assert.deepEqual(periodDates('this_month', NOW, TZ), { from: '2026-10-01', to: '2026-10-28' });
  assert.deepEqual(periodDates('last_month', NOW, TZ), { from: '2026-09-01', to: '2026-09-30' });
  const january = Date.parse('2027-01-10T12:00:00Z');
  assert.deepEqual(periodDates('last_month', january, TZ), {
    from: '2026-12-01',
    to: '2026-12-31',
  });
  assert.equal(datesBetween('2026-09-01', '2026-09-30').length, 30);
  assert.throws(() => periodDates('decade', NOW, TZ), RangeError);
  assert.equal(PERIODS.length, 7);
});

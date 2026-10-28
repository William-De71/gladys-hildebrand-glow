import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildMeterWidget,
  buildStatusWidget,
  dayPoints,
  dailyPoints,
  formatLatest,
  WIDGET_ACTIONS,
  CHART_SLOTS,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const TZ = 'Europe/London';
const NOW = Date.parse('2026-10-28T14:20:00Z');
const SLOT = 30 * 60 * 1000;
const STATES = ['ok', 'unknown', 'unconfigured', 'refused', 'rate_limited', 'error'];
const halfHours = Object.fromEntries(
  Array.from({ length: 60 }, (_, i) => [Date.parse('2026-10-27T00:00:00Z') + i * SLOT, 0.25]),
);
const days = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [
    new Date(Date.parse('2026-10-28T12:00:00Z') - i * 86400000).toISOString().slice(0, 10),
    { kwh: 9 + i / 10, known: 48, slots: 48, pence: 220 },
  ]),
);
const ELEC = {
  commodity: 'electricity',
  costId: 'c',
  today: { kwh: 6.14, pence: 150.4 },
  yesterday: { kwh: 14.94, pence: 366 },
  days,
  halfHours,
  latest: Date.parse('2026-10-28T12:30:00Z'),
  tariff: { rate: 24.5, standing: 60.12 },
  hasPower: true,
  power: { watts: 845, at: NOW },
};
const meter = (overrides = {}) =>
  buildMeterWidget({
    meter: ELEC,
    name: 'Electricity',
    connection: 'ok',
    language: 'en',
    timezone: TZ,
    now: NOW,
    ...overrides,
  });
const status = (overrides = {}) =>
  buildStatusWidget({
    connection: 'ok',
    meters: [
      { meter: ELEC, name: 'Electricity' },
      { meter: { ...ELEC, commodity: 'gas', latest: NOW - 20 * 3600000 }, name: 'Gas' },
    ],
    requests: 12,
    lastSuccessAt: NOW - 60000,
    language: 'en',
    timezone: TZ,
    now: NOW,
    ...overrides,
  });

test('every content passes the validation of the core, in every language and state', () => {
  for (const language of LANGUAGES) {
    for (const range of ['day', 'week', 'month']) {
      assert.deepEqual(
        validateWidgetContent(meter({ language, range })),
        [],
        `${language} ${range}`,
      );
    }
    assert.deepEqual(
      validateWidgetContent(
        meter({ language, meter: { ...ELEC, costId: null, hasPower: false, latest: null } }),
      ),
      [],
    );
    assert.deepEqual(validateWidgetContent(status({ language })), [], language);
    for (const connection of STATES) {
      assert.deepEqual(validateWidgetContent(meter({ language, meter: null, connection })), []);
      assert.deepEqual(validateWidgetContent(status({ language, connection, meters: [] })), []);
    }
    assert.deepEqual(validateWidgetContent(status({ language, pausedUntil: NOW + 600000 })), []);
  }
});

test('meter widget: today, its cost, yesterday, the power, 48 half-hours, how late the data are', () => {
  const content = meter();
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((c) => [c.label, c.value, c.unit]),
    [
      ['Today', 6.14, 'kWh'],
      ['Cost today', 1.5, '£'],
      ['Yesterday', 14.94, 'kWh'],
      ['Power', 845, 'W'],
    ],
  );
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.series[0].points.length, CHART_SLOTS);
  assert.equal(
    content.components.find((c) => c.variant === 'caption').text,
    'Electricity · data up to 13:00 (1 h ago)',
  );
  const button = content.components.at(-1);
  assert.equal(button.action.key, WIDGET_ACTIONS.REFRESH);
  // Week / month: the total of the days, a daily chart.
  const week = meter({ range: 'week' });
  assert.equal(week.components[2].label, '7 days');
  assert.equal(week.components.find((c) => c.type === 'chart').series[0].points.length, 7);
  const month = meter({ range: 'month', language: 'fr' });
  assert.equal(month.components.find((c) => c.type === 'chart').series[0].points.length, 30);
});

test('meter widget: without a meter, the hint of the connection state', () => {
  assert.match(meter({ meter: null }).components[0].text, /No smart meter/);
  assert.match(meter({ meter: null, connection: 'refused' }).components[0].text, /refuses/);
});

test('status widget: connection, data of each meter (late in orange), tariffs', () => {
  const rows = status().components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((r) => [r.label, r.value, r.color]),
    [
      ['Glowmarkt API', 'Connected', 'success'],
      ['Last reading', '1 min ago', 'neutral'],
      ['Electricity: data', 'up to 13:00', 'success'],
      ['Electricity: tariff', '24.5 p/kWh · 60.12 p/day', 'neutral'],
      ['Gas: data', 'up to 27/10 18:50', 'warning'],
      ['Gas: tariff', '24.5 p/kWh · 60.12 p/day', 'neutral'],
    ],
  );
});

test('charts and times', () => {
  const points = dayPoints(halfHours, NOW);
  assert.equal(points.at(-1).t, '2026-10-28T13:30:00.000Z', 'the last elapsed half-hour');
  assert.equal(points[0].t, '2026-10-27T14:00:00.000Z');
  const { points: week, total } = dailyPoints(days, 7, NOW, TZ);
  assert.equal(week.at(-1).t, '2026-10-28T12:00:00.000Z');
  assert.equal(total, Math.round((9 + 9.1 + 9.2 + 9.3 + 9.4 + 9.5 + 9.6) * 100) / 100);
  assert.equal(formatLatest(Date.parse('2026-10-28T12:30:00Z'), NOW, TZ, 'fr'), '13:00');
  assert.equal(formatLatest(Date.parse('2026-10-27T22:00:00Z'), NOW, TZ, 'en'), '27/10 22:30');
});

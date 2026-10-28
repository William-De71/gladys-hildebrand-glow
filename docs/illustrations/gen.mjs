// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// Three cards on the made-up meters of a British home, on a fixed evening
// (Wednesday 28 October 2026, 19:42 in London): the electricity meter with a
// Glow display (last 24 hours by half-hour, data up to 19:00), the gas meter
// over the last 30 days (colder days after the clock change), and the
// connection (tariffs, how recent the data are).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildMeterWidget, buildStatusWidget } = await load('src/widgets.js');
const { SLOT_MS, addDays, dayOf } = await load('src/glow.js');
const { LANGUAGES, t } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-28T19:42:00Z');
const TIMEZONE = 'Europe/London';
const LATEST = Date.parse('2026-10-28T18:30:00Z');

// A reproducible noise (no Math.random).
let seed = 7;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

// Electricity by half-hour: a night base, a morning and an evening peak.
const halfHours = {};
for (let start = LATEST - 60 * SLOT_MS; start <= LATEST; start += SLOT_MS) {
  const hour = new Date(start).getUTCHours();
  const base = hour < 6 ? 0.11 : hour < 9 ? 0.42 : hour < 16 ? 0.22 : hour < 22 ? 0.58 : 0.2;
  halfHours[start] = Math.round((base + noise() * 0.12) * 1000) / 1000;
}
const today = dayOf(NOW, TIMEZONE);
const sumOf = (date) =>
  Object.entries(halfHours)
    .filter(([start]) => dayOf(Number(start), TIMEZONE) === date)
    .reduce((sum, [, kwh]) => sum + kwh, 0);
const elecDays = {
  [today]: { kwh: sumOf(today), known: 38, slots: 48, pence: sumOf(today) * 24.5 },
  [addDays(today, -1)]: { kwh: 11.84, known: 48, slots: 48, pence: 11.84 * 24.5 },
};

// Gas by day: more after the clock change, less on a mild weekend.
const gasDays = {};
for (let i = 0; i < 30; i += 1) {
  const date = addDays(today, -i);
  const kwh = Math.round((i > 20 ? 22 : 38) + noise() * 14 - (i % 7 === 3 ? 6 : 0));
  gasDays[date] = { kwh, known: 48, slots: 48, pence: kwh * 6.24 };
}

const electricity = {
  id: 'e1',
  commodity: 'electricity',
  veName: 'Home',
  costId: 'e2',
  days: elecDays,
  halfHours,
  latest: LATEST,
  today: { kwh: elecDays[today].kwh, pence: elecDays[today].pence },
  yesterday: { kwh: 11.84, pence: 11.84 * 24.5 },
  tariff: { rate: 24.5, standing: 60.12 },
  hasPower: true,
  power: { watts: 1430, at: NOW - 20 * 1000 },
};
const gas = {
  id: 'g1',
  commodity: 'gas',
  veName: 'Home',
  costId: 'g2',
  days: gasDays,
  halfHours: {},
  latest: LATEST - 2 * SLOT_MS,
  today: { kwh: 24.6, pence: 24.6 * 6.24 },
  yesterday: { kwh: gasDays[addDays(today, -1)].kwh, pence: 0 },
  tariff: { rate: 6.24, standing: 31.65 },
  hasPower: false,
  power: null,
};

const contents = {};
for (const language of LANGUAGES) {
  const name = (meter) => t(`commodity_${meter.commodity}`, language);
  contents[language] = {
    meter: buildMeterWidget({
      meter: electricity,
      name: name(electricity),
      range: 'day',
      connection: 'ok',
      language,
      timezone: TIMEZONE,
      now: NOW,
    }),
    meter_month: buildMeterWidget({
      meter: gas,
      name: name(gas),
      range: 'month',
      connection: 'ok',
      language,
      timezone: TIMEZONE,
      now: NOW,
    }),
    status: buildStatusWidget({
      connection: 'ok',
      meters: [electricity, gas].map((meter) => ({ meter, name: name(meter) })),
      requests: 14,
      lastSuccessAt: NOW - 32 * 60 * 1000,
      language,
      timezone: TIMEZONE,
      now: NOW,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
// The second card is the same widget with other settings (gas, 30 days).
widgets.meter_month = widgets.meter;
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));

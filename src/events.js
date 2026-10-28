// -----------------------------------------------------------------------------
// Scene triggers and scene actions.
//
// Triggers fire on a TRANSITION between two readings of a meter, never on a
// snapshot: the first reading of a meter only sets its baseline. The last
// values are kept in /data across restarts (state.js), so nothing fires twice.
//
//   - daily_summary:  yesterday is complete (every half-hour received), or
//                     it is past noon and some are still missing: once per
//                     day, with the energy and the cost of the day;
//   - tariff_changed: the unit rate or the standing charge changed;
//   - data_delayed:   no new half-hour for 12 hours (the meter or the DCC
//                     stopped reporting);
//   - data_resumed:   half-hours arrive again after a data_delayed.
// -----------------------------------------------------------------------------

import { SLOT_MS, addDays, dayOf, localParts } from './glow.js';

const TRIGGERS = {
  DAILY_SUMMARY: 'daily_summary',
  TARIFF_CHANGED: 'tariff_changed',
  DATA_DELAYED: 'data_delayed',
  DATA_RESUMED: 'data_resumed',
};

const SCENE_ACTIONS = {
  GET_CONSUMPTION: 'get_consumption',
  REFRESH: 'refresh',
};

const PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_7_days',
  'this_month',
  'last_month',
  'last_30_days',
];
const DEFAULT_PERIOD = 'yesterday';
// No new half-hour for this long: the data are delayed.
const DELAY_HOURS = 12;
// From this local hour, yesterday is summarized even with missing half-hours.
const SUMMARY_HOUR = 12;

const pounds = (pence) => (pence === null || pence === undefined ? null : Math.round(pence) / 100);
// A price in pence -> pounds, to 0.00001 £ (rates have decimals of pence).
const price = (pence) =>
  pence === null || pence === undefined ? null : Math.round(pence * 1000) / 100000;
const kwh = (value) => Math.round((value ?? 0) * 1000) / 1000;

/**
 * @description How late the data of a meter are, in whole hours.
 * @param {number|null|undefined} latest - Start of the last half-hour received (ms).
 * @param {number} now - Now (ms).
 * @returns {number|null} The delay (null: nothing received yet).
 */
function delayHours(latest, now) {
  if (!Number.isFinite(latest)) return null;
  return Math.max(0, Math.floor((now - (latest + SLOT_MS)) / 3600000));
}

/**
 * @description The scene events of a new reading of a meter.
 * @param {object|null} previous - The snapshot of the previous reading (null:
 *   first reading, nothing fires).
 * @param {object} model - The meter: `{ commodity, days, latest, tariff }`.
 * @param {object} context - Context.
 * @param {string} context.device - The Gladys external id of the meter.
 * @param {string} context.name - The device name.
 * @param {number} context.now - Now (ms).
 * @param {string} context.timezone - IANA timezone.
 * @returns {{ events: Array<{key: string, data: object}>, snapshot: object }} The events.
 */
function detectEvents(previous, model, { device, name, now, timezone }) {
  const events = [];
  const base = { device, device_name: name, commodity: model.commodity };
  const today = dayOf(now, timezone);
  const yesterday = addDays(today, -1);
  const day = model.days?.[yesterday];
  const complete = Boolean(day && day.slots > 0 && day.known >= day.slots);
  const late = localParts(now, timezone).hour >= SUMMARY_HOUR && Boolean(day && day.known > 0);
  const hours = delayHours(model.latest, now);
  const snapshot = {
    summarized: complete || late ? yesterday : (previous?.summarized ?? null),
    delayed: hours === null ? (previous?.delayed ?? null) : hours >= DELAY_HOURS,
    rate: model.tariff?.rate ?? previous?.rate ?? null,
    standing: model.tariff?.standing ?? previous?.standing ?? null,
  };
  if (!previous) return { events, snapshot };

  if ((complete || late) && previous.summarized !== yesterday) {
    events.push({
      key: TRIGGERS.DAILY_SUMMARY,
      data: {
        ...base,
        date: yesterday,
        energy_kwh: kwh(day.kwh),
        cost: pounds(day.pence),
        complete,
      },
    });
  }
  const rateChanged =
    previous.rate !== null && snapshot.rate !== null && previous.rate !== snapshot.rate;
  const standingChanged =
    previous.standing !== null &&
    snapshot.standing !== null &&
    previous.standing !== snapshot.standing;
  if (rateChanged || standingChanged) {
    events.push({
      key: TRIGGERS.TARIFF_CHANGED,
      data: {
        ...base,
        unit_rate: price(snapshot.rate),
        previous_unit_rate: price(previous.rate),
        standing_charge: price(snapshot.standing),
        previous_standing_charge: price(previous.standing),
      },
    });
  }
  if (previous.delayed === false && snapshot.delayed === true) {
    events.push({
      key: TRIGGERS.DATA_DELAYED,
      data: { ...base, hours, latest: new Date(model.latest + SLOT_MS).toISOString() },
    });
  }
  if (previous.delayed === true && snapshot.delayed === false) {
    events.push({
      key: TRIGGERS.DATA_RESUMED,
      data: { ...base, hours, latest: new Date(model.latest + SLOT_MS).toISOString() },
    });
  }
  return { events, snapshot };
}

/**
 * @description The local dates of a period, ending today at the latest.
 * @param {string} period - One of PERIODS.
 * @param {number} now - Now (ms).
 * @param {string} timezone - IANA timezone.
 * @returns {{ from: string, to: string }} First and last dates (included).
 * @throws {RangeError} An unknown period.
 */
function periodDates(period, now, timezone) {
  const today = dayOf(now, timezone);
  const [year, month] = today.split('-').map(Number);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week': {
      // Weeks start on Monday (ISO 8601).
      const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(today, -weekday), to: today };
    }
    case 'last_7_days':
      return { from: addDays(today, -7), to: addDays(today, -1) };
    case 'this_month':
      return { from: firstOfMonth, to: today };
    case 'last_month': {
      const start = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
      return { from: start, to: addDays(firstOfMonth, -1) };
    }
    case 'last_30_days':
      return { from: addDays(today, -30), to: addDays(today, -1) };
    default:
      throw new RangeError(`Unknown period "${String(period).slice(0, 20)}"`);
  }
}

/**
 * @description The dates from one to another, both included.
 * @param {string} from - First date.
 * @param {string} to - Last date.
 * @returns {string[]} The dates.
 */
function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export {
  TRIGGERS,
  price,
  SCENE_ACTIONS,
  PERIODS,
  DEFAULT_PERIOD,
  DELAY_HOURS,
  SUMMARY_HOUR,
  delayHours,
  detectEvents,
  periodDates,
  datesBetween,
};

// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data/state.json (mode
// 0600, the only writable place of the container). Per meter (Glowmarkt
// consumption resource id):
//   - `halfHours` / `costHalfHours`: the known half-hours of the last 3 days
//     (kWh / pence, keyed by the slot start in ms): the 24-hour chart;
//   - `days`: per local date of the last 70 days, `{ kwh, known, slots,
//     pence }` (known: half-hours received out of `slots`);
//   - `latest`: start of the most recent half-hour received (ms);
//   - `sent`: the half-hours already given to Gladys (11 days), so that only
//     the new or corrected ones are published again;
//   - `backfilled`: the history was published once the device was created;
//   - `tariff`, `power`: the last tariff (pence) and whether the meter has a
//     power reading (a Glow display), with when it was last asked;
//   - `snapshot`: what the scene triggers compare (delay, day summarized,
//     tariff).
// A missing or unreadable file is an empty state: nothing fires on the first
// reading, the history is read again.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DAY_MS } from './glow.js';

const DEFAULT_PATH = '/data/state.json';
const KEEP = { halfHoursMs: 3 * DAY_MS, sentMs: 11 * DAY_MS, days: 70 };

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @description Drop the keys (slot starts in ms) older than a limit.
 * @param {object} slots - Slot start -> value.
 * @param {number} limit - Oldest kept (ms).
 * @returns {object} The kept slots.
 */
function pruneSlots(slots, limit) {
  return Object.fromEntries(
    Object.entries(slots ?? {}).filter(([start]) => Number(start) >= limit),
  );
}

/**
 * @description Create the store.
 * @param {object} [options] - Options.
 * @param {string|null} [options.path] - The file (null: memory only, tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} The store.
 */
function createState({ path = DEFAULT_PATH, logger = null } = {}) {
  let meters = {};
  let dirty = false;

  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      meters = isObject(parsed?.meters) ? parsed.meters : {};
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn(`Unreadable ${path}, starting afresh`);
    }
  }

  const record = (id) => {
    if (!isObject(meters[id])) meters[id] = {};
    return meters[id];
  };

  /**
   * @description Set a field of a meter when it changed.
   * @param {string} id - The meter.
   * @param {string} key - The field.
   * @param {unknown} value - The value.
   */
  function set(id, key, value) {
    const entry = record(id);
    if (same(entry[key], value)) return;
    entry[key] = value;
    dirty = true;
  }

  return {
    /**
     * @param {string} id - The meter.
     * @param {string} key - The field.
     * @returns {unknown} The value (undefined: never set).
     */
    get: (id, key) => (isObject(meters[id]) ? meters[id][key] : undefined),
    set,
    /**
     * @description Merge half-hours into a meter (kWh or pence), keep 3 days.
     * @param {string} id - The meter.
     * @param {'halfHours'|'costHalfHours'} key - Which ones.
     * @param {Map<number, number|null>} slots - Slot start -> value.
     * @param {number} now - Now (ms).
     */
    mergeSlots(id, key, slots, now) {
      const next = { ...(record(id)[key] ?? {}) };
      for (const [start, value] of slots) {
        if (value === null) continue;
        next[start] = Math.round(value * 100000) / 100000;
      }
      set(id, key, pruneSlots(next, now - KEEP.halfHoursMs));
    },
    /**
     * @description Merge days into a meter, keep the last 70.
     * @param {string} id - The meter.
     * @param {object} days - Date -> partial day `{ kwh?, known?, slots?, pence? }`.
     */
    mergeDays(id, days) {
      const next = { ...(record(id).days ?? {}) };
      for (const [date, day] of Object.entries(days)) next[date] = { ...next[date], ...day };
      const kept = Object.keys(next).sort().slice(-KEEP.days);
      set(id, 'days', Object.fromEntries(kept.map((date) => [date, next[date]])));
    },
    /**
     * @description Remember the half-hours given to Gladys, keep 11 days.
     * @param {string} id - The meter.
     * @param {Array<[number, number]>} entries - Slot start -> kWh.
     * @param {number} now - Now (ms).
     */
    markSent(id, entries, now) {
      const next = { ...(record(id).sent ?? {}) };
      for (const [start, kwh] of entries) next[start] = kwh;
      set(id, 'sent', pruneSlots(next, now - KEEP.sentMs));
    },
    /**
     * @description Forget what was given to Gladys (the device was created
     * again: everything is published again).
     * @param {string} id - The meter.
     */
    resetSent(id) {
      set(id, 'sent', {});
      set(id, 'backfilled', false);
    },
    /**
     * @description Drop the meters the account no longer has.
     * @param {string[]} ids - The ids to keep.
     */
    keep(ids) {
      const wanted = new Set(ids);
      for (const id of Object.keys(meters)) {
        if (!wanted.has(id)) {
          delete meters[id];
          dirty = true;
        }
      }
    },
    /** @description Write the file when something changed (atomically). */
    save() {
      if (!dirty || !path) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, JSON.stringify({ meters }), { mode: 0o600 });
        renameSync(temporary, path);
        dirty = false;
      } catch (err) {
        logger?.warn(`Unable to write ${path}: ${err.message}`);
      }
    },
  };
}

export { DEFAULT_PATH, KEEP, createState };

// -----------------------------------------------------------------------------
// The Glowmarkt data model: the meters of an account, the half-hours, the
// days, the tariff and the instantaneous power.
//
// - A virtual entity is a home; its resources are classified:
//   `electricity.consumption` (kWh), `electricity.consumption.cost` (pence),
//   `gas.consumption` (kWh: Hildebrand converts the m³ of the meter),
//   `gas.consumption.cost` (pence). One meter = one consumption resource and,
//   when it exists, the cost resource of the same commodity and home.
// - Readings: `data` is `[[unix seconds of the slot start, value|null], …]`.
//   The DCC half-hours arrive 30 minutes to several hours late, and the
//   last ones of the day are filled progressively: a null is "not yet".
// - The days are the days of the Gladys timezone (Europe/London when Gladys
//   gives none: the meters are British).
// - The tariff answer comes in two shapes: `currentRates: { rate,
//   standingCharge }` (seen by pyglowmarkt) or the documented
//   `plan: [{ planDetail: [{ rate }, { standing }] }]`. Both in pence.
// -----------------------------------------------------------------------------

const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const COMMODITIES = ['electricity', 'gas'];
const CLASSIFIERS = {
  electricity: { consumption: 'electricity.consumption', cost: 'electricity.consumption.cost' },
  gas: { consumption: 'gas.consumption', cost: 'gas.consumption.cost' },
};
// A reading spans 10 days at most with PT30M (the API refuses longer ones).
const MAX_HALF_HOUR_SPAN_MS = 10 * DAY_MS;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @description The meters of an account, from its virtual entities and their
 * resources.
 * @param {Array<{ve: object, resources: object[]}>} homes - Each virtual
 *   entity with its resources.
 * @returns {object[]} The meters `{ id, commodity, veId, veName, costId, name }`,
 *   electricity first.
 */
function parseMeters(homes) {
  const meters = [];
  for (const { ve, resources } of homes ?? []) {
    const veId = text(ve?.veId);
    if (!veId) continue;
    for (const commodity of COMMODITIES) {
      const find = (classifier) =>
        (resources ?? []).find(
          (resource) => resource?.classifier === classifier && text(resource?.resourceId),
        );
      const consumption = find(CLASSIFIERS[commodity].consumption);
      if (!consumption) continue;
      const cost = find(CLASSIFIERS[commodity].cost);
      meters.push({
        id: text(consumption.resourceId),
        commodity,
        veId,
        veName: text(ve.name),
        costId: cost ? text(cost.resourceId) : null,
      });
    }
  }
  return meters.sort((a, b) => COMMODITIES.indexOf(a.commodity) - COMMODITIES.indexOf(b.commodity));
}

// --- Time -------------------------------------------------------------------

/**
 * @description The local wall clock of an instant in a timezone.
 * @param {number} ms - The instant.
 * @param {string} timezone - IANA timezone.
 * @returns {{year: number, month: number, day: number, hour: number, minute: number}} The parts.
 */
function localParts(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * @description The local date of an instant ("2026-10-28").
 * @param {number} ms - The instant.
 * @param {string} timezone - IANA timezone.
 * @returns {string} The date.
 */
function dayOf(ms, timezone) {
  const { year, month, day } = localParts(ms, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @description The offset of a timezone at an instant, in ms (local - UTC).
 * @param {number} ms - The instant.
 * @param {string} timezone - IANA timezone.
 * @returns {number} The offset.
 */
function offsetOf(ms, timezone) {
  const p = localParts(ms, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / 60000) * 60000;
}

/**
 * @description The instant of the local midnight that starts a date.
 * @param {string} date - "2026-10-28".
 * @param {string} timezone - IANA timezone.
 * @returns {number} The instant (ms).
 */
function midnightOf(date, timezone) {
  const [year, month, day] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let ms = guess - offsetOf(guess, timezone);
  // A second pass settles a clock change between the guess and the answer.
  ms = guess - offsetOf(ms, timezone);
  return ms;
}

/**
 * @description The date a number of days before or after another one.
 * @param {string} date - "2026-10-28".
 * @param {number} days - Days to add (negative: before).
 * @returns {string} The date.
 */
function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * @description The number of half-hours of a local day (46, 48 or 50).
 * @param {string} date - "2026-10-28".
 * @param {string} timezone - IANA timezone.
 * @returns {number} The count.
 */
function slotsOfDay(date, timezone) {
  return Math.round(
    (midnightOf(addDays(date, 1), timezone) - midnightOf(date, timezone)) / SLOT_MS,
  );
}

/**
 * @description The start of the half-hour containing an instant.
 * @param {number} ms - The instant.
 * @returns {number} The slot start (ms).
 */
const slotOf = (ms) => Math.floor(ms / SLOT_MS) * SLOT_MS;

// --- Readings ----------------------------------------------------------------

/**
 * @description The half-hours of a readings answer.
 * @param {Array} data - `[[unix seconds, value|null], …]`.
 * @returns {Map<number, number|null>} Slot start (ms) -> value (null: not yet).
 */
function parseReadings(data) {
  const slots = new Map();
  for (const entry of Array.isArray(data) ? data : []) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const seconds = Number(entry[0]);
    if (!Number.isFinite(seconds)) continue;
    const raw = entry[1];
    const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    slots.set(seconds * 1000, Number.isFinite(value) && value >= 0 ? value : null);
  }
  return slots;
}

/**
 * @description The days a set of half-hours covers: total and number of
 * half-hours known, for each local date.
 * @param {Map<number, number|null>} slots - Slot start -> value.
 * @param {string} timezone - IANA timezone.
 * @returns {Map<string, {total: number, known: number}>} The days.
 */
function sumByDay(slots, timezone) {
  const days = new Map();
  for (const [start, value] of slots) {
    const date = dayOf(start, timezone);
    const day = days.get(date) ?? { total: 0, known: 0 };
    if (value !== null) {
      day.total += value;
      day.known += 1;
    }
    days.set(date, day);
  }
  return days;
}

/**
 * @description The ranges of a span of time the API accepts with PT30M
 * (10 days at most each).
 * @param {number} from - Start (ms).
 * @param {number} to - End (ms).
 * @returns {Array<[number, number]>} The ranges, oldest first.
 */
function splitRange(from, to) {
  const ranges = [];
  for (let start = from; start < to; start += MAX_HALF_HOUR_SPAN_MS) {
    ranges.push([start, Math.min(to, start + MAX_HALF_HOUR_SPAN_MS)]);
  }
  return ranges;
}

// --- Tariff and power --------------------------------------------------------

/**
 * @description A number from a value the API may give as a string.
 * @param {unknown} value - The value.
 * @returns {number|null} The number.
 */
function numberOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @description The latest tariff of a resource.
 * @param {Array<object>} data - The `data` of the tariff answer.
 * @returns {{rate: number|null, standing: number|null}|null} Pence per kWh
 *   and pence per day (null: no tariff).
 */
function parseTariff(data) {
  const entries = (Array.isArray(data) ? data : []).filter(
    (entry) => entry && typeof entry === 'object',
  );
  if (entries.length === 0) return null;
  // The most recent one when several are listed.
  const latest = [...entries].sort((a, b) =>
    String(b.from ?? '').localeCompare(String(a.from ?? '')),
  )[0];
  let rate = numberOf(latest.currentRates?.rate);
  let standing = numberOf(latest.currentRates?.standingCharge);
  const details = (Array.isArray(latest.plan) ? latest.plan : []).flatMap((plan) =>
    Array.isArray(plan?.planDetail) ? plan.planDetail : [],
  );
  for (const detail of details) {
    if (rate === null) rate = numberOf(detail?.rate);
    if (standing === null) standing = numberOf(detail?.standing);
  }
  if (rate === null && standing === null) return null;
  return { rate, standing };
}

/**
 * @description The instantaneous power of a `current` answer, when it is
 * recent: only a Glow display (IHD / CAD) feeds it; without one, the answer
 * is empty or an error.
 * @param {{units: string|null, data: Array}} answer - The answer.
 * @param {number} now - Now (ms).
 * @param {number} [maxAgeMs] - Older readings are ignored.
 * @returns {{watts: number, at: number}|null} The power.
 */
function parseCurrent(answer, now, maxAgeMs = 15 * 60 * 1000) {
  const [entry] = Array.isArray(answer?.data) ? answer.data : [];
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const at = Number(entry[0]) * 1000;
  let watts = numberOf(entry[1]);
  if (!Number.isFinite(at) || watts === null) return null;
  const units = String(answer.units ?? 'W').toLowerCase();
  if (units === 'kw') watts *= 1000;
  else if (units !== 'w') return null;
  if (now - at > maxAgeMs || watts < 0) return null;
  return { watts: Math.round(watts), at };
}

export {
  SLOT_MS,
  DAY_MS,
  COMMODITIES,
  CLASSIFIERS,
  MAX_HALF_HOUR_SPAN_MS,
  parseMeters,
  localParts,
  dayOf,
  offsetOf,
  midnightOf,
  addDays,
  slotsOfDay,
  slotOf,
  parseReadings,
  sumByDay,
  splitRange,
  numberOf,
  parseTariff,
  parseCurrent,
};

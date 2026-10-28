// -----------------------------------------------------------------------------
// Dashboard widgets, built from what the integration already read (no request
// to Glowmarkt).
//
//   - meter:  one meter (the electricity one when none is chosen): energy
//             today, its cost, yesterday (or the 7 / 30 days), the power with
//             a Glow display, and a bar chart (the last 24 hours by
//             half-hour, or the last 7 / 30 days), with how late the data
//             are;
//   - status: the connection to the Glowmarkt API, how far the data of each
//             meter go, its tariff, the requests of the last hour.
//
// The content stays within the budget of the core (8 components, 1 focal,
// 2 texts, 1 status, 4 buttons) and every text exists in the four languages
// (test/widgets.test.js runs validateWidgetContent on them).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { SLOT_MS, addDays, dayOf } from './glow.js';
import { DELAY_HOURS, delayHours } from './events.js';
import { t, ago, formatNumber } from './i18n.js';

const WIDGETS = { METER: 'meter', STATUS: 'status' };
const WIDGET_ACTIONS = { REFRESH: 'refresh' };
const RANGES = { DAY: 'day', WEEK: 'week', MONTH: 'month' };
const RANGE_DAYS = { week: 7, month: 30 };
const TTL_SECONDS = 300;
const CHART_SLOTS = 48;

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * @description A local time ("14:30").
 * @param {number} ms - The instant.
 * @param {string} timezone - IANA timezone.
 * @param {string} language - The language.
 * @returns {string} The time.
 */
function formatTime(ms, timezone, language) {
  return new Intl.DateTimeFormat(LOCALES[language] ?? 'en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

/**
 * @description The end of the data of a meter, as shown: "14:30", or
 * "27/10 14:30" when it is not today.
 * @param {number} latest - Start of the last half-hour received (ms).
 * @param {number} now - Now (ms).
 * @param {string} timezone - IANA timezone.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function formatLatest(latest, now, timezone, language) {
  const end = latest + SLOT_MS;
  const time = formatTime(end, timezone, language);
  if (dayOf(end, timezone) === dayOf(now, timezone)) return time;
  const date = new Intl.DateTimeFormat(LOCALES[language] ?? 'en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
  }).format(end);
  return `${date} ${time}`;
}

/**
 * @description The 24-hour chart: the last 48 half-hours (0 when missing).
 * @param {object} halfHours - Slot start (ms) -> kWh.
 * @param {number} now - Now (ms).
 * @returns {Array<{t: string, v: number}>} The points.
 */
function dayPoints(halfHours, now) {
  const last = Math.floor(now / SLOT_MS) * SLOT_MS - SLOT_MS;
  const points = [];
  for (let i = CHART_SLOTS - 1; i >= 0; i -= 1) {
    const start = last - i * SLOT_MS;
    const value = halfHours?.[start];
    points.push({ t: new Date(start).toISOString(), v: Math.round((value ?? 0) * 1000) / 1000 });
  }
  return points;
}

/**
 * @description The daily chart: the last n days, today included.
 * @param {object} days - Date -> `{ kwh }`.
 * @param {number} count - Days.
 * @param {number} now - Now (ms).
 * @param {string} timezone - IANA timezone.
 * @returns {{points: Array<{t: string, v: number}>, total: number}} The points and their sum.
 */
function dailyPoints(days, count, now, timezone) {
  const today = dayOf(now, timezone);
  const points = [];
  let total = 0;
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const value = Math.round((days?.[date]?.kwh ?? 0) * 100) / 100;
    total += value;
    points.push({ t: `${date}T12:00:00.000Z`, v: value });
  }
  return { points, total: Math.round(total * 100) / 100 };
}

/**
 * @description An empty card: one sentence.
 * @param {string} key - The text.
 * @param {string} language - The language.
 * @returns {object} The content.
 */
const emptyCard = (key, language) => ({
  ttl_seconds: TTL_SECONDS,
  components: [{ type: 'text', variant: 'body', text: t(key, language) }],
});

/**
 * @description The meter widget.
 * @param {object} options - Options.
 * @param {object|null} options.meter - The meter model (`commodity`, `today`,
 *   `yesterday`, `days`, `halfHours`, `latest`, `costId`, `hasPower`, `power`).
 * @param {string} options.name - Its name.
 * @param {string} [options.range] - day, week or month.
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {string} options.language - The language.
 * @param {string} options.timezone - IANA timezone.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildMeterWidget({
  meter,
  name,
  range = RANGES.DAY,
  connection,
  language,
  timezone,
  now,
}) {
  if (!meter)
    return emptyCard(
      connection === 'ok' ? 'emptyMeters' : `connection_${connection}_hint`,
      language,
    );
  const components = [
    {
      type: 'value',
      value: Math.round((meter.today?.kwh ?? 0) * 100) / 100,
      unit: 'kWh',
      label: t('tileToday', language),
      icon: meter.commodity === 'gas' ? 'thermometer' : 'zap',
      color: WIDGET_COLORS.PRIMARY,
    },
  ];
  if (meter.costId) {
    const pence = meter.today?.pence;
    components.push({
      type: 'value',
      value: pence === null || pence === undefined ? '—' : Math.round(pence) / 100,
      unit: '£',
      label: t('tileCostToday', language),
      icon: 'credit-card',
    });
  }
  let chart;
  if (range === RANGES.WEEK || range === RANGES.MONTH) {
    const { points, total } = dailyPoints(meter.days, RANGE_DAYS[range], now, timezone);
    components.push({
      type: 'value',
      value: total,
      unit: 'kWh',
      label: t(range === RANGES.WEEK ? 'tileWeek' : 'tileMonth', language),
      icon: 'calendar',
    });
    chart = {
      type: 'chart',
      chart_type: 'bar',
      title: t(range === RANGES.WEEK ? 'chartWeek' : 'chartMonth', language),
      unit: 'kWh',
      series: [{ name: t('chartSeries', language), points }],
    };
  } else {
    components.push({
      type: 'value',
      value: Math.round((meter.yesterday?.kwh ?? 0) * 100) / 100,
      unit: 'kWh',
      label: t('tileYesterday', language),
      icon: 'calendar',
    });
    chart = {
      type: 'chart',
      chart_type: 'bar',
      title: t('chartDay', language),
      unit: 'kWh',
      series: [{ name: t('chartSeries', language), points: dayPoints(meter.halfHours, now) }],
    };
  }
  if (meter.hasPower) {
    components.push({
      type: 'value',
      value: meter.power ? meter.power.watts : '—',
      ...(meter.power ? { unit: 'W' } : {}),
      label: t('tilePower', language),
      icon: 'activity',
      color: meter.power?.watts > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push(chart);
  components.push({
    type: 'text',
    variant: 'caption',
    text: Number.isFinite(meter.latest)
      ? t('captionLatest', language, {
          meter: name,
          time: formatLatest(meter.latest, now, timezone, language),
          ago: ago(meter.latest + SLOT_MS, now, language),
        })
      : t('captionNoData', language, { meter: name }),
  });
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

const CONNECTION_COLOR = {
  ok: WIDGET_COLORS.SUCCESS,
  unconfigured: WIDGET_COLORS.WARNING,
  refused: WIDGET_COLORS.DANGER,
  rate_limited: WIDGET_COLORS.WARNING,
  error: WIDGET_COLORS.DANGER,
  unknown: WIDGET_COLORS.NEUTRAL,
};

/**
 * @description The status widget.
 * @param {object} options - Options.
 * @param {string} options.connection - ok, unconfigured, refused, rate_limited, error, unknown.
 * @param {Array<{meter: object, name: string}>} options.meters - The meters.
 * @param {number} options.requests - Requests of the last hour.
 * @param {number} options.lastSuccessAt - Last successful reading (ms, 0: never).
 * @param {number} [options.pausedUntil] - End of a slow-down (ms, 0: none).
 * @param {string} options.language - The language.
 * @param {string} options.timezone - IANA timezone.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildStatusWidget({
  connection,
  meters,
  requests,
  lastSuccessAt,
  pausedUntil = 0,
  language,
  timezone,
  now,
}) {
  const components = [
    { type: 'value', value: meters.length, label: t('tileMeters', language), icon: 'zap' },
    { type: 'value', value: requests, label: t('tileRequests', language), icon: 'activity' },
  ];
  const rows = [
    {
      label: t('rowConnection', language),
      value: t(`connection_${connection}`, language),
      color: CONNECTION_COLOR[connection] ?? WIDGET_COLORS.NEUTRAL,
    },
    {
      label: t('rowLastReading', language),
      value: ago(lastSuccessAt, now, language),
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  for (const { meter, name } of meters.slice(0, 2)) {
    const hours = delayHours(meter.latest, now);
    rows.push({
      label: t('rowData', language, { meter: name }),
      value:
        hours === null
          ? t('never', language)
          : t('upTo', language, { time: formatLatest(meter.latest, now, timezone, language) }),
      color: hours === null || hours >= DELAY_HOURS ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
    if (meter.tariff) {
      const value = (pence) =>
        pence === null || pence === undefined ? '—' : formatNumber(pence, language, 2);
      rows.push({
        label: t('rowTariff', language, { meter: name }),
        value: t('tariffValue', language, {
          rate: value(meter.tariff.rate),
          standing: value(meter.tariff.standing),
        }),
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (pausedUntil > now) {
    rows.push({
      label: t('rowPaused', language),
      value: t('inMinutes', language, { n: Math.ceil((pausedUntil - now) / 60000) }),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items: rows });
  if (connection !== 'ok' && connection !== 'unknown') {
    components.push({
      type: 'text',
      variant: 'body',
      text: t(`connection_${connection}_hint`, language),
    });
  } else if (connection === 'ok' && meters.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t('emptyMeters', language) });
  }
  components.push({
    type: 'button',
    label: t('buttonRefresh', language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  RANGES,
  TTL_SECONDS,
  CHART_SLOTS,
  formatTime,
  formatLatest,
  dayPoints,
  dailyPoints,
  buildMeterWidget,
  buildStatusWidget,
};

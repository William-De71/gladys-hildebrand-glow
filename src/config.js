// -----------------------------------------------------------------------------
// Configuration of the Hildebrand Glow integration.
//
// Fields of the config_schema:
//   - `username`         the e-mail of the Bright account;
//   - `password`         its password, a secret: never logged;
//   - `refresh_minutes`  how often the half-hours are read (30 or 60 min);
//   - `power_minutes`    how often the power is read, for a meter with a Glow
//                        display (1, 2, 5 or 10 min);
//   - `history_days`     days of half-hours given to Gladys when an
//                        electricity meter is added (0, 7, 31 or 90);
//   - `catchup`          ask Hildebrand to fetch the DCC at each half-hour;
//   - `language`         language of the texts Gladys does not ask for in a
//                        language (device and feature names, messages of the
//                        configuration button): `auto` follows the last
//                        widget request, and guesses it from the timezone of
//                        Gladys until a widget is shown.
//
// Internal key, outside the config_schema (stored with setConfig):
//   - `last_language`  language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';

const REFRESH_MINUTES = { options: [30, 60], default: 30 };
const POWER_MINUTES = { options: [1, 2, 5, 10], default: 2 };
const HISTORY_DAYS = { options: [0, 7, 31, 90], default: 31 };
const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
// The meters are British: the days are those of London when Gladys gives no
// timezone.
const DEFAULT_TIMEZONE = 'Europe/London';

/**
 * @description One of the allowed numbers, or the default.
 * @param {unknown} value - The raw value.
 * @param {{options: number[], default: number}} spec - The allowed values.
 * @returns {number} The number.
 */
function pick(value, spec) {
  const n = Number(value);
  return spec.options.includes(n) ? n : spec.default;
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {{ username: string, password: string, refreshMinutes: number,
 *   powerMinutes: number, historyDays: number, catchup: boolean,
 *   language: string }} The config.
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    username: text(config.username),
    // A password may start or end with a space: kept as typed.
    password: typeof config.password === 'string' ? config.password : '',
    refreshMinutes: pick(config.refresh_minutes, REFRESH_MINUTES),
    powerMinutes: pick(config.power_minutes, POWER_MINUTES),
    historyDays: pick(config.history_days, HISTORY_DAYS),
    catchup: config.catchup !== false && config.catchup !== 'false',
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// Timezones of the countries speaking one of the languages of the
// integration; any other one is English. A guess for the first devices only:
// the first widget shown gives the real language.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Panama',
    'America/Costa_Rica',
    'America/Guatemala',
    'America/Santo_Domingo',
    'America/Puerto_Rico',
  ],
};

/**
 * @description The language guessed from a timezone, before any widget.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) return 'es';
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description The stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string|null} fallback - The language when nothing valid is stored.
 * @returns {string|null} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

/**
 * @description The timezone of Gladys (TZ, set by the supervisor); London
 * when none is given (or UTC, the default of a container).
 * @returns {string} IANA timezone.
 */
function resolveTimezone() {
  const zone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (!zone || zone === 'UTC' || zone === 'Etc/UTC') return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export {
  REFRESH_MINUTES,
  POWER_MINUTES,
  HISTORY_DAYS,
  DEFAULT_TIMEZONE,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  normalizeConfig,
  guessLanguage,
  readLanguage,
  resolveTimezone,
};

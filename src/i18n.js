// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: device and feature names, widget contents, toasts, messages of the
// Configuration screen. Vocabulary of the Gladys interface: appareil / Gerät /
// dispositivo, scène / Szene / escena; British energy words: unit rate
// (prix du kWh), standing charge (abonnement journalier).
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // device names
  deviceElectricity: {
    en: 'Electricity meter',
    fr: 'Compteur d’électricité',
    de: 'Stromzähler',
    es: 'Contador de electricidad',
  },
  deviceGas: { en: 'Gas meter', fr: 'Compteur de gaz', de: 'Gaszähler', es: 'Contador de gas' },
  commodity_electricity: { en: 'Electricity', fr: 'Électricité', de: 'Strom', es: 'Electricidad' },
  commodity_gas: { en: 'Gas', fr: 'Gaz', de: 'Gas', es: 'Gas' },

  // feature names (Discovery, device page)
  feature_consumption: {
    en: 'Consumption (half-hours)',
    fr: 'Consommation (demi-heures)',
    de: 'Verbrauch (Halbstunden)',
    es: 'Consumo (medias horas)',
  },
  feature_energy_today: {
    en: 'Energy today',
    fr: 'Énergie aujourd’hui',
    de: 'Energie heute',
    es: 'Energía hoy',
  },
  feature_energy_yesterday: {
    en: 'Energy yesterday',
    fr: 'Énergie hier',
    de: 'Energie gestern',
    es: 'Energía ayer',
  },
  feature_cost_today: {
    en: 'Cost today',
    fr: 'Coût aujourd’hui',
    de: 'Kosten heute',
    es: 'Coste hoy',
  },
  feature_cost_yesterday: {
    en: 'Cost yesterday',
    fr: 'Coût hier',
    de: 'Kosten gestern',
    es: 'Coste ayer',
  },
  feature_unit_rate: {
    en: 'Unit rate (per kWh)',
    fr: 'Prix du kWh',
    de: 'Arbeitspreis (pro kWh)',
    es: 'Precio del kWh',
  },
  feature_standing_charge: {
    en: 'Standing charge (per day)',
    fr: 'Abonnement (par jour)',
    de: 'Grundpreis (pro Tag)',
    es: 'Cargo fijo (por día)',
  },
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },

  // widget: meter
  tileToday: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tileYesterday: { en: 'Yesterday', fr: 'Hier', de: 'Gestern', es: 'Ayer' },
  tileCostToday: { en: 'Cost today', fr: 'Coût du jour', de: 'Kosten heute', es: 'Coste hoy' },
  tileWeek: { en: '7 days', fr: '7 jours', de: '7 Tage', es: '7 días' },
  tileMonth: { en: '30 days', fr: '30 jours', de: '30 Tage', es: '30 días' },
  tilePower: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  chartDay: {
    en: 'Last 24 hours, by half-hour',
    fr: 'Dernières 24 heures, par demi-heure',
    de: 'Letzte 24 Stunden, je Halbstunde',
    es: 'Últimas 24 horas, por media hora',
  },
  chartWeek: {
    en: 'Last 7 days',
    fr: '7 derniers jours',
    de: 'Letzte 7 Tage',
    es: 'Últimos 7 días',
  },
  chartMonth: {
    en: 'Last 30 days',
    fr: '30 derniers jours',
    de: 'Letzte 30 Tage',
    es: 'Últimos 30 días',
  },
  chartSeries: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },
  captionLatest: {
    en: '{meter} · data up to {time} ({ago})',
    fr: '{meter} · données jusqu’à {time} ({ago})',
    de: '{meter} · Daten bis {time} ({ago})',
    es: '{meter} · datos hasta las {time} ({ago})',
  },
  captionNoData: {
    en: '{meter} · no half-hour received yet',
    fr: '{meter} · aucune demi-heure reçue pour l’instant',
    de: '{meter} · noch keine Halbstunde empfangen',
    es: '{meter} · aún no se ha recibido ninguna media hora',
  },
  emptyMeters: {
    en: 'No smart meter in this Bright account. Check that your meters appear in the Bright app.',
    fr: 'Aucun compteur communicant sur ce compte Bright. Vérifiez que vos compteurs apparaissent dans l’application Bright.',
    de: 'Kein Smart Meter in diesem Bright-Konto. Prüfen Sie, ob Ihre Zähler in der Bright-App erscheinen.',
    es: 'Ningún contador inteligente en esta cuenta Bright. Compruebe que sus contadores aparecen en la app Bright.',
  },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },

  // widget: status
  tileMeters: { en: 'Meters', fr: 'Compteurs', de: 'Zähler', es: 'Contadores' },
  tileRequests: {
    en: 'Requests (1 h)',
    fr: 'Requêtes (1 h)',
    de: 'Anfragen (1 h)',
    es: 'Peticiones (1 h)',
  },
  rowConnection: {
    en: 'Glowmarkt API',
    fr: 'API Glowmarkt',
    de: 'Glowmarkt-API',
    es: 'API Glowmarkt',
  },
  rowLastReading: {
    en: 'Last reading',
    fr: 'Dernier relevé',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  },
  rowData: {
    en: '{meter}: data',
    fr: '{meter} : données',
    de: '{meter}: Daten',
    es: '{meter}: datos',
  },
  rowTariff: {
    en: '{meter}: tariff',
    fr: '{meter} : tarif',
    de: '{meter}: Tarif',
    es: '{meter}: tarifa',
  },
  rowPaused: {
    en: 'Slowed down, next try',
    fr: 'Ralenti, prochain essai',
    de: 'Gedrosselt, nächster Versuch',
    es: 'Ralentizado, próximo intento',
  },
  upTo: { en: 'up to {time}', fr: 'jusqu’à {time}', de: 'bis {time}', es: 'hasta las {time}' },
  tariffValue: {
    en: '{rate} p/kWh · {standing} p/day',
    fr: '{rate} p/kWh · {standing} p/jour',
    de: '{rate} p/kWh · {standing} p/Tag',
    es: '{rate} p/kWh · {standing} p/día',
  },
  unknown: { en: 'unknown', fr: 'inconnu', de: 'unbekannt', es: 'desconocido' },
  inMinutes: { en: 'in {n} min', fr: 'dans {n} min', de: 'in {n} Min.', es: 'en {n} min' },
  connection_ok: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
  connection_unknown: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Iniciando' },
  connection_unconfigured: {
    en: 'Not configured',
    fr: 'Non configurée',
    de: 'Nicht eingerichtet',
    es: 'Sin configurar',
  },
  connection_refused: {
    en: 'Sign-in refused',
    fr: 'Connexion refusée',
    de: 'Anmeldung abgelehnt',
    es: 'Inicio rechazado',
  },
  connection_rate_limited: {
    en: 'Too many requests',
    fr: 'Trop de requêtes',
    de: 'Zu viele Anfragen',
    es: 'Demasiadas peticiones',
  },
  connection_error: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  connection_unknown_hint: {
    en: 'The integration is starting: the meters appear after the first reading.',
    fr: 'L’intégration démarre : les compteurs apparaissent après le premier relevé.',
    de: 'Die Integration startet: Die Zähler erscheinen nach der ersten Abfrage.',
    es: 'La integración se está iniciando: los contadores aparecen tras la primera lectura.',
  },
  connection_unconfigured_hint: {
    en: 'Enter the e-mail and the password of your Bright account in the configuration of the integration.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Bright dans la configuration de l’intégration.',
    de: 'Geben Sie E-Mail und Passwort Ihres Bright-Kontos in der Konfiguration der Integration ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta Bright en la configuración de la integración.',
  },
  connection_refused_hint: {
    en: 'Glowmarkt refuses the e-mail or the password: check them in the Bright app, then in the configuration.',
    fr: 'Glowmarkt refuse l’e-mail ou le mot de passe : vérifiez-les dans l’application Bright, puis dans la configuration.',
    de: 'Glowmarkt lehnt E-Mail oder Passwort ab: Prüfen Sie sie in der Bright-App, dann in der Konfiguration.',
    es: 'Glowmarkt rechaza el correo o la contraseña: compruébelos en la app Bright y luego en la configuración.',
  },
  connection_rate_limited_hint: {
    en: 'Glowmarkt asks to slow down: the integration spaces its readings and goes back to normal by itself.',
    fr: 'Glowmarkt demande de ralentir : l’intégration espace ses relevés et revient seule au rythme normal.',
    de: 'Glowmarkt bittet um weniger Anfragen: Die Integration verlängert die Abstände und kehrt von selbst zum normalen Takt zurück.',
    es: 'Glowmarkt pide reducir el ritmo: la integración espacia sus lecturas y vuelve sola al ritmo normal.',
  },
  connection_error_hint: {
    en: 'The Glowmarkt API does not answer. Check the Internet connection of Gladys; the integration tries again by itself.',
    fr: 'L’API Glowmarkt ne répond pas. Vérifiez la connexion Internet de Gladys ; l’intégration réessaie d’elle-même.',
    de: 'Die Glowmarkt-API antwortet nicht. Prüfen Sie die Internetverbindung von Gladys; die Integration versucht es von selbst erneut.',
    es: 'La API Glowmarkt no responde. Compruebe la conexión a Internet de Gladys; la integración lo reintenta sola.',
  },

  // relative times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} days ago', fr: 'il y a {n} jours', de: 'vor {n} Tagen', es: 'hace {n} días' },

  // Configuration screen (setConnectionStatus)
  statusUnconfigured: {
    en: 'Enter the e-mail and the password of your Bright account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Bright.',
    de: 'Geben Sie E-Mail und Passwort Ihres Bright-Kontos ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta Bright.',
  },
  statusRefused: {
    en: 'Glowmarkt refuses the sign-in: check the e-mail and the password of the Bright account.',
    fr: 'Glowmarkt refuse la connexion : vérifiez l’e-mail et le mot de passe du compte Bright.',
    de: 'Glowmarkt lehnt die Anmeldung ab: Prüfen Sie E-Mail und Passwort des Bright-Kontos.',
    es: 'Glowmarkt rechaza el inicio de sesión: compruebe el correo y la contraseña de la cuenta Bright.',
  },
  statusRateLimited: {
    en: 'Glowmarkt asks to slow down: next reading in {n} min.',
    fr: 'Glowmarkt demande de ralentir : prochain relevé dans {n} min.',
    de: 'Glowmarkt bittet um weniger Anfragen: nächste Abfrage in {n} Min.',
    es: 'Glowmarkt pide reducir el ritmo: próxima lectura en {n} min.',
  },
  statusError: {
    en: 'The Glowmarkt API does not answer ({error}); next try in a few minutes.',
    fr: 'L’API Glowmarkt ne répond pas ({error}) ; nouvel essai dans quelques minutes.',
    de: 'Die Glowmarkt-API antwortet nicht ({error}); neuer Versuch in einigen Minuten.',
    es: 'La API Glowmarkt no responde ({error}); nuevo intento en unos minutos.',
  },
  statusOk: {
    en: '{count} smart meter(s): {list}. Half-hours read every {minutes} min.',
    fr: '{count} compteur(s) communicant(s) : {list}. Demi-heures relevées toutes les {minutes} min.',
    de: '{count} Smart Meter: {list}. Halbstunden alle {minutes} Min. abgefragt.',
    es: '{count} contador(es) inteligente(s): {list}. Medias horas leídas cada {minutes} min.',
  },
  statusNoMeter: {
    en: 'Connected, but the Bright account has no smart meter: check that your meters appear in the Bright app.',
    fr: 'Connectée, mais le compte Bright n’a aucun compteur communicant : vérifiez que vos compteurs apparaissent dans l’application Bright.',
    de: 'Verbunden, aber das Bright-Konto hat kein Smart Meter: Prüfen Sie, ob Ihre Zähler in der Bright-App erscheinen.',
    es: 'Conectada, pero la cuenta Bright no tiene contador inteligente: compruebe que sus contadores aparecen en la app Bright.',
  },

  // toasts and action results
  toastRefreshed: {
    en: '{n} meter(s) read.',
    fr: '{n} compteur(s) relevé(s).',
    de: '{n} Zähler abgefragt.',
    es: '{n} contador(es) leído(s).',
  },
  toastTooSoon: {
    en: 'Already read {ago}: the next half-hours come in a few minutes.',
    fr: 'Déjà relevé {ago} : les prochaines demi-heures arrivent dans quelques minutes.',
    de: 'Bereits {ago} abgefragt: Die nächsten Halbstunden kommen in einigen Minuten.',
    es: 'Ya leído {ago}: las próximas medias horas llegan en unos minutos.',
  },
  toastFailed: {
    en: 'Glowmarkt: {error}',
    fr: 'Glowmarkt : {error}',
    de: 'Glowmarkt: {error}',
    es: 'Glowmarkt: {error}',
  },

  // "Test the connection" button
  testOk: {
    en: 'Connected. {count} smart meter(s): {list}',
    fr: 'Connexion réussie. {count} compteur(s) communicant(s) : {list}',
    de: 'Verbunden. {count} Smart Meter: {list}',
    es: 'Conexión correcta. {count} contador(es) inteligente(s): {list}',
  },
  testMeter: {
    en: '{name} (today {kwh} kWh, data up to {time}, {features} features)',
    fr: '{name} (aujourd’hui {kwh} kWh, données jusqu’à {time}, {features} fonctionnalités)',
    de: '{name} (heute {kwh} kWh, Daten bis {time}, {features} Funktionen)',
    es: '{name} (hoy {kwh} kWh, datos hasta las {time}, {features} funciones)',
  },
};

/**
 * @description Whether a value is one of the languages of the integration.
 * @param {unknown} language - The value.
 * @returns {boolean} A language.
 */
const isLanguage = (language) => LANGUAGES.includes(language);

/**
 * @description A text in a language (English fallback), with its
 * substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('minutesAgo', 'fr', { n: 3 }); // -> 'il y a 3 min'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) return key;
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/**
 * @description The text in every language, for a multi-language message.
 * @param {string|Function} key - The TEXTS key, or `(language) => string`.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function' ? key(language) : t(key, language, values),
    ]),
  );
}

const locale = (language) => (isLanguage(language) ? language : 'en');

/**
 * @description A number written in a language ("20,5", "20.5").
 * @param {number} n - The number.
 * @param {string} language - The language.
 * @param {number} [digits] - Maximum decimals.
 * @returns {string} The text.
 */
const formatNumber = (n, language, digits = 1) =>
  new Intl.NumberFormat(locale(language), { maximumFractionDigits: digits }).format(n);

/**
 * @description How long ago an instant was: "just now", "12 min ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) return t('never', language);
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return t('justNow', language);
  if (minutes < 60) return t('minutesAgo', language, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('hoursAgo', language, { n: hours });
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

export { LANGUAGES, TEXTS, isLanguage, t, all, formatNumber, ago };

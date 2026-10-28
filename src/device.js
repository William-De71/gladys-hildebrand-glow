// -----------------------------------------------------------------------------
// One Gladys device per smart meter of the Bright account (one per commodity
// and home), with these features:
//
//   key               category / type                               unit           present when
//   consumption       energy-sensor / thirty-minutes-consumption    kilowatt-hour  electricity
//   energy_today      energy-sensor / index-today                   kilowatt-hour  always
//   energy_yesterday  energy-sensor / index-yesterday               kilowatt-hour  always
//   cost_today        currency / decimal                            pound-sterling a cost resource
//   cost_yesterday    currency / decimal                            pound-sterling a cost resource
//   unit_rate         currency / decimal (£ per kWh)                pound-sterling a tariff rate
//   standing_charge   currency / decimal (£ per day)                pound-sterling a standing charge
//   power             energy-sensor / power                         watt           a Glow display
//
// `consumption` is the one Gladys prices and charts in its energy screens:
// the integration publishes each half-hour at its real time with
// publishEnergyConsumption (the DCC data arrive late), never an index, and
// Gladys adds its cost feature itself. Electricity only: Gladys attaches every
// consumption to the main ELECTRIC meter, so gas would be added to the
// electricity. `energy_today` / `energy_yesterday` are the totals of the days
// (types that never feed the energy pipeline), the costs and the tariff are
// those of the Bright account (pence converted into pounds).
//
// The feature keys, categories, types, units and bounds are forever (the
// Discovery "Update" button compares them): see test/structure.test.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const DEVICE_TYPE = 'meter';

const readOnly = { read_only: true, has_feedback: false };
const round = (value, digits) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits));

// Order = order of the features in Gladys. `present` decides from the meter
// model; `value` gives the state (null: nothing to publish).
const FEATURES = [
  {
    key: 'consumption',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 1000,
    ...readOnly,
    present: (m) => m.commodity === 'electricity',
    // Published as dated half-hours, never as a state.
    value: () => null,
  },
  {
    key: 'energy_today',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX_TODAY,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000,
    ...readOnly,
    present: () => true,
    value: (m) => round(m.today?.kwh, 3),
  },
  {
    key: 'energy_yesterday',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX_YESTERDAY,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000,
    ...readOnly,
    present: () => true,
    value: (m) => round(m.yesterday?.kwh, 3),
  },
  {
    key: 'cost_today',
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.POUND_STERLING,
    min: 0,
    max: 100000,
    ...readOnly,
    present: (m) => Boolean(m.costId),
    value: (m) =>
      m.today?.pence === null || m.today?.pence === undefined
        ? null
        : round(m.today.pence / 100, 2),
  },
  {
    key: 'cost_yesterday',
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.POUND_STERLING,
    min: 0,
    max: 100000,
    ...readOnly,
    present: (m) => Boolean(m.costId),
    value: (m) =>
      m.yesterday?.pence === null || m.yesterday?.pence === undefined
        ? null
        : round(m.yesterday.pence / 100, 2),
  },
  {
    key: 'unit_rate',
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.POUND_STERLING,
    min: 0,
    max: 100,
    ...readOnly,
    present: (m) => Boolean(m.hasRate),
    value: (m) =>
      m.tariff?.rate === null || m.tariff?.rate === undefined
        ? null
        : round(m.tariff.rate / 100, 5),
  },
  {
    key: 'standing_charge',
    category: CATEGORIES.CURRENCY,
    type: TYPES.CURRENCY.DECIMAL,
    unit: UNITS.POUND_STERLING,
    min: 0,
    max: 100,
    ...readOnly,
    present: (m) => Boolean(m.hasStanding),
    value: (m) =>
      m.tariff?.standing === null || m.tariff?.standing === undefined
        ? null
        : round(m.tariff.standing / 100, 5),
  },
  {
    key: 'power',
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
    ...readOnly,
    present: (m) => m.commodity === 'electricity' && Boolean(m.hasPower),
    value: (m) => (m.power ? m.power.watts : null),
  },
];
const FEATURE_KEYS = FEATURES.map((feature) => feature.key);

/**
 * @description The ids of a meter. The Glowmarkt resource id is a UUID; it is
 * URI-encoded anyway so a colon could never cut a feature id.
 * @param {object} gladys - The Gladys client (externalIds).
 * @param {string} id - The consumption resource id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
function idsOf(gladys, id) {
  return gladys.externalIds(DEVICE_TYPE, encodeURIComponent(id));
}

/**
 * @description The features a meter has.
 * @param {object} model - A meter model.
 * @returns {object[]} The feature specs.
 */
function featuresOf(model) {
  return FEATURES.filter((feature) => feature.present(model));
}

/**
 * @description The name of a meter: "Electricity meter", followed by the
 * home when the account has several ("Gas meter (Cottage)").
 * @param {object} model - A meter model.
 * @param {string} language - The language.
 * @param {boolean} [withHome] - Add the home name.
 * @returns {string} The name.
 */
function deviceName(model, language, withHome = false) {
  const name = t(model.commodity === 'gas' ? 'deviceGas' : 'deviceElectricity', language);
  return withHome && model.veName ? `${name} (${model.veName})` : name;
}

/**
 * @description The Discovery payload of a meter.
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A meter model.
 * @param {string} language - Language of the names.
 * @param {boolean} [withHome] - Add the home to the name.
 * @returns {object} The device.
 */
function buildDevice(gladys, model, language = 'en', withHome = false) {
  const ids = idsOf(gladys, model.id);
  return {
    name: deviceName(model, language, withHome),
    external_id: ids.device,
    model: model.commodity === 'gas' ? 'Smart gas meter (DCC)' : 'Smart electricity meter (DCC)',
    should_poll: false,
    params: [
      { name: 'GLOW_COMMODITY', value: model.commodity },
      { name: 'GLOW_HOME', value: model.veName || model.veId || 'unknown' },
    ],
    features: featuresOf(model).map((feature) => {
      // eslint-disable-next-line no-unused-vars
      const { key, present, value, ...fields } = feature;
      return {
        ...fields,
        name: t(`feature_${key}`, language),
        external_id: ids.feature(key),
      };
    }),
  };
}

/**
 * @description The states of a meter (never the consumption: dated half-hours).
 * @param {object} gladys - The Gladys client.
 * @param {object} model - A meter model.
 * @returns {Array<{device_feature_external_id: string, state: number}>} The states.
 */
function buildStates(gladys, model) {
  const ids = idsOf(gladys, model.id);
  return featuresOf(model).flatMap((feature) => {
    const state = feature.value(model);
    return state === null || state === undefined || !Number.isFinite(state)
      ? []
      : [{ device_feature_external_id: ids.feature(feature.key), state }];
  });
}

/**
 * @description What Discovery would compare: a change republishes the list.
 * @param {object} gladys - The Gladys client.
 * @param {object[]} models - Meter models.
 * @param {string} language - Language of the names.
 * @param {boolean} withHome - Add the home to the names.
 * @returns {string} A signature.
 */
function discoverySignature(gladys, models, language, withHome) {
  return JSON.stringify(
    models.map((model) => {
      const device = buildDevice(gladys, model, language, withHome);
      return [device.external_id, device.name, device.features.map((f) => [f.external_id, f.name])];
    }),
  );
}

export {
  DEVICE_TYPE,
  FEATURES,
  FEATURE_KEYS,
  idsOf,
  featuresOf,
  deviceName,
  buildDevice,
  buildStates,
  discoverySignature,
};

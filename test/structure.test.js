// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids, the fields the Discovery "Update" button compares (category, type,
// unit, min, max, step), and every key of the manifest a scene, a widget or a
// saved configuration refers to.
//
// test/fixtures/discovery.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would have to delete
// and recreate a device, or would lose a scene or a widget setting: never
// update the baseline without a documented migration.
//
// Regenerate (first release only): UPDATE_BASELINE=1 node --test test/structure.test.js
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMeters } from '../src/glow.js';
import { buildDevice } from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';
import { VE, RESOURCES, fakeGladys } from './helpers/fixtures.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baselineUrl = new URL('./fixtures/discovery.baseline.json', import.meta.url);
const manifest = read('../gladys-assistant-integration.json');

const ETERNAL = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];
const pick = (feature) =>
  Object.fromEntries(
    ETERNAL.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
const keys = (list) => (list ?? []).map((item) => item.key);
const byKey = (list) => new Map((list ?? []).map((item) => [item.key, item]));
const shape = (device) => ({
  external_id: device.external_id,
  should_poll: device.should_poll,
  params: device.params.map((param) => param.name),
  features: device.features.map((feature) => ({
    ...pick(feature),
    supported_options: (feature.supported_options ?? []).map((option) => option.value),
  })),
});

// Every feature a meter can have (with a cost, a tariff, a Glow display),
// and the fewest.
const [elec, gas] = parseMeters([{ ve: VE, resources: RESOURCES }]);
const everything = { hasRate: true, hasStanding: true, hasPower: true };
const devices = (language) => ({
  electricity: buildDevice(fakeGladys, { ...elec, ...everything }, language),
  electricity_bare: buildDevice(fakeGladys, { ...elec, costId: null }, language),
  gas: buildDevice(fakeGladys, { ...gas, ...everything }, language),
});

/**
 * @description The keys of the manifest users store.
 * @returns {object} The keys.
 */
function manifestKeys() {
  return {
    config_schema: manifest.config_schema.map(({ key, type }) => ({ key, type })),
    config_options: Object.fromEntries(
      manifest.config_schema
        .filter((field) => field.options)
        .map((field) => [field.key, field.options.map((option) => option.value)]),
    ),
    actions: keys(manifest.actions),
    widgets: manifest.widgets.map((w) => ({ key: w.key, settings: keys(w.settings) })),
    widget_actions: ['refresh'],
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: (trigger.fields ?? []).map(({ key, options }) => ({
        key,
        options: (options ?? []).map((option) => option.value),
      })),
      variables: trigger.variables.map(({ key, type }) => ({ key, type })),
    })),
    scene_actions: manifest.scene_actions.map((action) => ({
      key: action.key,
      fields: (action.fields ?? []).map(({ key, options }) => ({
        key,
        options: (options ?? []).map((option) => option.value),
      })),
      outputs: action.outputs.map(({ key, type }) => ({ key, type })),
    })),
  };
}

const current = () => ({
  devices: Object.fromEntries(
    Object.entries(devices('en')).map(([kind, device]) => [kind, shape(device)]),
  ),
  manifest: manifestKeys(),
});

if (process.env.UPDATE_BASELINE === '1') {
  writeFileSync(baselineUrl, `${JSON.stringify(current(), null, 2)}\n`);
}
const baseline = read('./fixtures/discovery.baseline.json');

test('the devices keep their external ids and the fields Discovery compares, in every language', () => {
  for (const language of LANGUAGES) {
    const now = Object.fromEntries(
      Object.entries(devices(language)).map(([kind, device]) => [kind, shape(device)]),
    );
    assert.deepEqual(now, baseline.devices, language);
  }
});

test('no configuration key or option, action, widget or widget button disappears', () => {
  const now = manifestKeys();
  const config = byKey(manifest.config_schema);
  for (const { key, type } of baseline.manifest.config_schema) {
    assert.equal(config.get(key)?.type, type, `config_schema.${key}`);
  }
  for (const [key, options] of Object.entries(baseline.manifest.config_options)) {
    options.forEach((value) =>
      assert.ok(now.config_options[key].includes(value), `${key}: ${value}`),
    );
  }
  baseline.manifest.actions.forEach((key) => assert.ok(now.actions.includes(key), key));
  baseline.manifest.widget_actions.forEach((key) =>
    assert.ok(now.widget_actions.includes(key), key),
  );
  const widgets = byKey(now.widgets);
  for (const widget of baseline.manifest.widgets) {
    widget.settings.forEach((key) =>
      assert.ok(widgets.get(widget.key)?.settings.includes(key), `${widget.key}.${key}`),
    );
  }
});

test('scene triggers and actions keep their keys, options, variables and outputs', () => {
  const now = manifestKeys();
  for (const listKey of ['scene_triggers', 'scene_actions']) {
    const list = byKey(now[listKey]);
    for (const entry of baseline.manifest[listKey]) {
      const found = list.get(entry.key);
      assert.ok(found, `${listKey}.${entry.key}`);
      const fields = byKey(found.fields);
      for (const { key, options } of entry.fields) {
        assert.ok(fields.has(key), `${entry.key}.${key}`);
        options.forEach((value) =>
          assert.ok(fields.get(key).options.includes(value), `${entry.key}.${key}: ${value}`),
        );
      }
      const values = byKey(found.variables ?? found.outputs);
      for (const { key, type } of entry.variables ?? entry.outputs) {
        assert.equal(values.get(key)?.type, type, `${entry.key}.${key}`);
      }
    }
  }
  // A required field without a default breaks the scenes already saved.
  const actions = byKey(manifest.scene_actions);
  for (const entry of baseline.manifest.scene_actions) {
    const known = new Set(entry.fields.map((field) => field.key));
    for (const field of actions.get(entry.key).fields ?? []) {
      if (!known.has(field.key)) {
        assert.ok(!field.required || field.default !== undefined, `${entry.key}.${field.key}`);
      }
    }
  }
});

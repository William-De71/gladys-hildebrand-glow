import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { TRIGGERS, SCENE_ACTIONS, PERIODS, DEFAULT_PERIOD } from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS, RANGES } from '../src/widgets.js';
import { REFRESH_MINUTES, POWER_MINUTES, HISTORY_DAYS, AUTO_LANGUAGE } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-hildebrand-glow';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Hildebrand Glow (DCC)');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-hildebrand-glow:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-hildebrand-glow');
});

test('declares the cloud transport: the Glowmarkt API only, never a local device', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(source('../src/glow-api.js'), /https:\/\/api\.glowmarkt\.com\/api\/v0-1/);
  for (const file of ['glow', 'app', 'device', 'events', 'widgets', 'state', 'config', 'i18n']) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 (keywords, countries, dated consumption); British meters only; no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.countries, ['GB']);
  assert.deepEqual(manifest.categories, ['energy']);
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/, 'no button form');
  for (const key of ['location', 'network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [config.get('username').type, config.get('username').required],
    ['string', true],
  );
  assert.deepEqual(
    [config.get('password').type, config.get('password').required],
    ['secret', true],
  );
  assert.equal(config.get('password').default, undefined);
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(WIDGETS\\.${key}`), key);
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), ['refresh']);
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  // Every trigger filters by device and commodity, keys of the event data.
  for (const trigger of manifest.scene_triggers) {
    const [device, commodity] = trigger.fields;
    assert.deepEqual([device.key, device.type, device.source], ['device', 'select', 'devices']);
    assert.ok(!device.required, `${trigger.key}: empty = every meter`);
    assert.deepEqual(values(commodity), ['electricity', 'gas']);
    const variables = trigger.variables.map((v) => v.key);
    assert.deepEqual(variables.slice(0, 3), ['device', 'device_name', 'commodity'], trigger.key);
  }
});

test('the scene actions mirror the code: periods, outputs', () => {
  const actions = byKey(manifest.scene_actions);
  const fields = byKey(actions.get('get_consumption').fields);
  assert.ok(!fields.get('device').required, 'empty = the electricity meter');
  assert.deepEqual(values(fields.get('period')), PERIODS);
  assert.equal(fields.get('period').default, DEFAULT_PERIOD);
  assert.deepEqual(
    actions.get('get_consumption').outputs.map((o) => [o.key, o.type]),
    [
      ['energy_kwh', 'number'],
      ['cost', 'number'],
      ['days', 'number'],
      ['complete', 'boolean'],
      ['from', 'string'],
      ['to', 'string'],
    ],
  );
  assert.deepEqual(
    actions.get('refresh').outputs.map((o) => o.key),
    [
      'electricity_today_kwh',
      'electricity_today_cost',
      'electricity_latest',
      'gas_today_kwh',
      'gas_today_cost',
      'gas_latest',
    ],
  );
});

test('the configuration and the widget settings mirror the code', () => {
  const config = byKey(manifest.config_schema);
  for (const [key, spec] of [
    ['refresh_minutes', REFRESH_MINUTES],
    ['power_minutes', POWER_MINUTES],
    ['history_days', HISTORY_DAYS],
  ]) {
    assert.deepEqual(values(config.get(key)), spec.options.map(String), key);
    assert.equal(config.get(key).default, String(spec.default), key);
  }
  assert.deepEqual([config.get('catchup').type, config.get('catchup').default], ['boolean', true]);
  const language = config.get('language');
  assert.deepEqual(values(language), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(language.default, AUTO_LANGUAGE);
  const intro = config.get('intro');
  assert.equal(intro.type, 'section');
  assert.ok(intro.links.every((link) => link.url.startsWith('https://')));
  assert.match(intro.description.en, /Bright app/);
  const meter = byKey(manifest.widgets).get('meter');
  const settings = byKey(meter.settings);
  assert.equal(settings.get('device').source, 'devices');
  assert.deepEqual(values(settings.get('range')), Object.values(RANGES));
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('catalog keywords of Gladys 5.3.0', () => {
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10, 'one to ten keywords');
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length, 'unique once trimmed and lowercased');
});

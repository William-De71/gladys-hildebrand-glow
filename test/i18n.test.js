import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { LANGUAGES, TEXTS, all, t } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../gladys-assistant-integration.json'));
const REPO = 'William-De71/gladys-hildebrand-glow';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const READMES = { en: 'README.md', fr: 'README.fr.md', de: 'README.de.md', es: 'README.es.md' };

/**
 * @description Every multi-language object of the manifest, with its path.
 * @param {unknown} node - A manifest node.
 * @param {string} path - Its path.
 * @returns {Array<[string, object]>} The texts.
 */
function texts(node, path = '') {
  if (Array.isArray(node)) return node.flatMap((child, i) => texts(child, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') return [[path, node]];
    return Object.entries(node).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [];
}

test('every manifest text (widgets, triggers, actions, fields, variables, outputs) has 4 languages', () => {
  const found = texts(manifest);
  assert.ok(found.length > 50);
  for (const [path, text] of found) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(text[language]?.trim(), `${path}.${language} is missing`);
    }
  }
});

test('catalog description: 10 to 100 characters per language', () => {
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length}`);
  }
});

test('widget labels: 3 to 30 characters, descriptions: 100 at most, per language', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const { length } = widget.label[language];
      assert.ok(length >= 3 && length <= 30, `${widget.key}.label.${language}: ${length}`);
      const size = widget.description[language].length;
      assert.ok(size <= 100, `${widget.key}.description.${language}: ${size}`);
    }
  }
});

test('every runtime text exists in the four languages, with the same placeholders', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, entry] of Object.entries(TEXTS)) {
    for (const language of LANGUAGES) {
      assert.ok(entry[language], `${key}.${language} is missing`);
      assert.deepEqual(placeholders(entry[language]), placeholders(entry.en), `${key}.${language}`);
    }
  }
  assert.equal(t('tileToday', 'it'), 'Today', 'English fallback');
  assert.equal(t('nope', 'fr'), 'nope');
});

test('texts stay within the bounds of Gladys (status 200, buttons and tiles 24, captions 80)', () => {
  for (const key of ['statusUnconfigured', 'statusRefused', 'statusNoMeter', 'statusError']) {
    for (const [language, text] of Object.entries(all(key, { error: 'HTTP 503' }))) {
      assert.ok(text.length <= 200, `${key}.${language}: ${text.length}`);
    }
  }
  const list = 'Electricity meter (Cottage), Gas meter (Cottage), Electricity meter (Home)';
  for (const [language, text] of Object.entries(all('statusOk', { count: 3, list, minutes: 30 }))) {
    assert.ok(text.length <= 200, `statusOk.${language}: ${text.length}`);
  }
  for (const key of [
    'buttonRefresh',
    'tileToday',
    'tileYesterday',
    'tileCostToday',
    'tileWeek',
    'tileMonth',
    'tilePower',
    'tileMeters',
    'tileRequests',
  ]) {
    for (const [language, text] of Object.entries(all(key))) {
      assert.ok(text.length <= 24, `${key}.${language}`);
    }
  }
  for (const key of Object.keys(TEXTS).filter((k) => /^connection_[a-z_]+_hint$/.test(k))) {
    for (const [language, text] of Object.entries(all(key))) {
      assert.ok(text.length <= 300, `${key}.${language}: ${text.length}`);
    }
  }
  for (const [language, text] of Object.entries(
    all((lang) =>
      t('captionLatest', lang, {
        meter: `${t('commodity_electricity', lang)} (Cottage)`,
        time: '27/10 22:30',
        ago: t('hoursAgo', lang, { n: 23 }),
      }),
    ),
  )) {
    assert.ok(text.length <= 80, `captionLatest.${language}: ${text.length}`);
  }
  for (const [language, text] of Object.entries(all('feature_standing_charge'))) {
    assert.ok(text.length <= 40, `feature names stay short: ${language}`);
  }
});

test('docs: the four languages, same structure, more than 300 characters', () => {
  const headings = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  const tables = (text) => text.split('\n').filter((line) => /^\|\s*-/.test(line)).length;
  const docs = Object.fromEntries(
    LANGUAGES.map((language) => {
      const path = new URL(`../docs/${language}.md`, import.meta.url);
      assert.ok(existsSync(path), `docs/${language}.md is missing`);
      return [language, readFileSync(path, 'utf8')];
    }),
  );
  for (const language of LANGUAGES) {
    assert.ok(docs[language].length > 300, `docs/${language}.md is too short`);
    assert.equal(headings(docs[language]), headings(docs.en), `docs/${language}.md headings`);
    assert.equal(tables(docs[language]), tables(docs.en), `docs/${language}.md tables`);
    // The store re-hosts the docs: images by absolute URL only.
    for (const [, url] of docs[language].matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      assert.match(url, /^https:\/\/raw\.githubusercontent\.com\//, `docs/${language}.md: ${url}`);
    }
  }
});

test('docs: the generated widget image of their language, never the cover', () => {
  for (const language of LANGUAGES) {
    const text = read(`../docs/${language}.md`);
    assert.ok(text.includes(`(${RAW}docs/assets/widgets.${language}.png)`), language);
    assert.match(
      text,
      /generated illustration|illustration générée|generierte Illustration|ilustración generada/i,
    );
    assert.doesNotMatch(text, /cover\.jpg/, 'the store already shows the cover');
  }
});

test('README: badges, the cover under them, the widget image of their language', () => {
  for (const [language, file] of Object.entries(READMES)) {
    const text = read(`../${file}`);
    const lines = text.split('\n');
    const badges = lines.findIndex((line) => line.includes('img.shields.io/badge/'));
    assert.match(lines[badges], /badge\/(license|licence|Lizenz|licencia)-Apache--2\.0/, file);
    assert.match(
      text,
      /github\/v\/release\/William-De71\/gladys-hildebrand-glow\?sort=semver/,
      file,
    );
    assert.match(
      text,
      /workflow\/status\/William-De71\/gladys-hildebrand-glow\/release\.yml/,
      file,
    );
    assert.match(text, /Gladys-%E2%89%A5%205\.3\.0/, file);
    // The cover right under the four badges, before the pitch.
    assert.match(
      lines[badges + 5],
      /^!\[Hildebrand Glow \(DCC\) (for|pour|für|para) Gladys Assistant\]\(cover\.jpg\)$/,
      file,
    );
    assert.ok(text.includes(`(docs/assets/widgets.${language}.png)`), `${file} widget image`);
    assert.ok(text.includes('(docs/assets/architecture.svg)'), file);
    assert.ok(text.includes('(docs/assets/release-pipeline.svg)'), file);
    assert.equal((text.match(/```mermaid/g) ?? []).length, 2, `${file}: architecture, sequence`);
    assert.match(text, /pyglowmarkt/, `${file}: credit`);
  }
});

test('images: every generated widget image and the cover exist', () => {
  for (const language of LANGUAGES) {
    const png = readFileSync(new URL(`../docs/assets/widgets.${language}.png`, import.meta.url));
    assert.equal(png.toString('latin1', 1, 4), 'PNG', language);
  }
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  // JPEG SOF0/SOF2 frame: height then width.
  const frame = cover.findIndex(
    (byte, index) => byte === 0xff && [0xc0, 0xc2].includes(cover[index + 1]),
  );
  assert.deepEqual([cover.readUInt16BE(frame + 7), cover.readUInt16BE(frame + 5)], [800, 534]);
});

test('README: one per language, same structure, each linking to the three others', () => {
  const headings = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  const english = read(`../${READMES.en}`);
  for (const file of Object.values(READMES)) {
    const path = new URL(`../${file}`, import.meta.url);
    assert.ok(existsSync(path), `${file} is missing`);
    const text = readFileSync(path, 'utf8');
    for (const other of Object.values(READMES).filter((name) => name !== file)) {
      assert.ok(text.includes(`](${other})`), `${file} does not link to ${other}`);
    }
    assert.equal(headings(text), headings(english), `${file} headings`);
    for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
      assert.ok(
        existsSync(new URL(`../${target.split('#')[0]}`, import.meta.url)),
        `${file}: ${target}`,
      );
    }
  }
});

test('the automatic language is guessed from the timezone before any widget', async () => {
  const { guessLanguage } = await import('../src/config.js');
  assert.deepEqual(
    [
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Madrid',
      'America/Argentina/Cordoba',
      'Asia/Tokyo',
      '',
    ].map(guessLanguage),
    ['fr', 'de', 'es', 'es', 'en', 'en'],
  );
});

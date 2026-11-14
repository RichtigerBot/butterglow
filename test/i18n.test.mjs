import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import de from '../src/i18n/de.js';
import en from '../src/i18n/en.js';
import { getLanguage, onLanguageChange, resolveLanguage, setLanguageForTest, t } from '../src/i18n/i18n.js';

function flatten(table, prefix = '') {
  return Object.entries(table).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`)));
}
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('English and German have the same keys and placeholders', () => {
  const english = new Map(flatten(en));
  const german = new Map(flatten(de));
  assert.deepEqual([...german.keys()].filter((key) => !english.has(key)), [], 'only in de.js');
  assert.deepEqual([...english.keys()].filter((key) => !german.has(key)), [], 'only in en.js');
  for (const [key, text] of english) assert.deepEqual(placeholders(german.get(key)), placeholders(text), key);
  for (const [key, text] of [...english, ...german]) assert.ok(text.trim(), `${key} is empty`);
});

test('Every key used in the code exists', async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n') await walk(path); // the tables themselves and the comments in i18n.js
      }
      else if (/\.(js|html)$/.test(entry.name)) files.push(path);
    }
  }
  const root = new URL('../src', import.meta.url).pathname;
  await walk(root);
  const keys = new Set(flatten(en).map(([key]) => key));
  const missing = [];
  // t('key'), data-i18n="key", data-i18n-…="key" and schema labels such as label: 'settings.water.level'.
  const patterns = [/\bt\('([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/g, /data-i18n(?:-[\w-]+)?="([^"]+)"/g, /\blabel: '([a-z]+\.[\w.]+)'/g, /\btitle: '([a-z]+\.[\w.]+)'/g];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const pattern of patterns) for (const [, key] of text.matchAll(pattern)) if (!keys.has(key)) missing.push(`${file.slice(root.length + 1)}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test('Placeholders are filled, unknown ones stay visible', () => {
  setLanguageForTest('en');
  assert.equal(t('settings.milkdrop.every', { seconds: 15 }), 'Every 15 s');
  assert.equal(t('settings.milkdrop.every'), 'Every {seconds} s');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('Switching the language changes the texts and notifies listeners', () => {
  setLanguageForTest('en');
  const seen = [];
  const stop = onLanguageChange((language) => seen.push(language));
  setLanguageForTest('de');
  assert.equal(getLanguage(), 'de');
  assert.equal(t('editor.save'), 'Speichern');
  setLanguageForTest('de'); // no change, no notification
  setLanguageForTest('en');
  assert.equal(t('editor.save'), 'Save');
  stop();
  assert.deepEqual(seen, ['de', 'en']);
});

test('Automatic follows the browser language', () => {
  assert.equal(resolveLanguage('auto', 'de-AT'), 'de');
  assert.equal(resolveLanguage('auto', 'en-GB'), 'en');
  assert.equal(resolveLanguage('auto', 'fr-FR'), 'en');
  assert.equal(resolveLanguage('de', 'en-US'), 'de');
  assert.equal(resolveLanguage('xx', 'de-DE'), 'de');
});

test('Help, value descriptions and templates exist in both languages', async () => {
  const { helpFor, valueInfo } = await import('../src/milk/variables.js');
  const { TEMPLATES } = await import('../src/milk/templates.js');
  const texts = () => ({
    help: helpFor('frame').map((entry) => entry.text),
    groups: [...valueInfo('base').labels.values()],
    template: TEMPLATES[1].preset().frame_eqs_eel,
  });
  setLanguageForTest('en');
  const english = texts();
  setLanguageForTest('de');
  const german = texts();
  setLanguageForTest('en');
  assert.equal(english.help.length, german.help.length);
  assert.ok(english.groups.includes('Motion') && german.groups.includes('Bewegung'));
  assert.match(english.template, /Basic motion/);
  assert.match(german.template, /Grundbewegung/);
});

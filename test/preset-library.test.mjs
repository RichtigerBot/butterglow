// Tests favourites and collections without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL, FAVORITES, OWN, parsePresetName, PresetLibrary } from '../src/ui/preset-library.js';
import { setLanguageForTest } from '../src/i18n/i18n.js';

setLanguageForTest('en');

const names = ['Flexi - mindblob', 'Geiss - Reaction', '_Mig_049', 'martin - dark galaxy'];

test('Author and title are read from the name', () => {
  assert.deepEqual(parsePresetName('Flexi - mindblob [shiny mix]'), { author: 'Flexi', title: 'mindblob [shiny mix]' });
  assert.deepEqual(parsePresetName('_Mig_049'), { author: '', title: '_Mig_049' });
  assert.deepEqual(parsePresetName('a - b - c'), { author: 'a', title: 'b - c' });
  assert.deepEqual(parsePresetName('_Geiss - Artifact 03'), { author: 'Geiss', title: 'Artifact 03' });
});

test('Star sets and removes favourites and saves', () => {
  const saved = [];
  const library = new PresetLibrary({}, { save: (data) => saved.push(data) });
  assert.equal(library.toggleFavorite('_Mig_049'), true);
  assert.equal(library.isFavorite('_Mig_049'), true);
  assert.equal(library.toggleFavorite('_Mig_049'), false);
  assert.equal(library.isFavorite('_Mig_049'), false);
  assert.equal(saved.length, 2);
});

test('Selected favourites only play favourites', () => {
  const library = new PresetLibrary();
  library.toggleFavorite('Geiss - Reaction');
  library.toggleFavorite('_Mig_049');
  library.setActive(FAVORITES);
  assert.deepEqual(library.pool(names), { names: ['Geiss - Reaction', '_Mig_049'], fallback: false });
});

test('An empty collection plays all and reports it', () => {
  const library = new PresetLibrary();
  library.setActive(FAVORITES);
  assert.deepEqual(library.pool(names), { names, fallback: true });
});

test('Create, fill, rename and delete own collections', () => {
  const library = new PresetLibrary();
  const id = library.createCollection('  Chill  ');
  assert.ok(id);
  assert.equal(library.createCollection('   '), null);
  library.toggle(id, 'martin - dark galaxy');
  library.toggle(id, 'Flexi - mindblob');
  library.setActive(id);
  assert.deepEqual(library.pool(names).names, ['martin - dark galaxy', 'Flexi - mindblob']);
  assert.ok(library.renameCollection(id, 'Ruhig'));
  assert.equal(library.collections.find((entry) => entry.id === id).name, 'Ruhig');
  assert.ok(library.deleteCollection(id));
  assert.equal(library.active, ALL);
  assert.equal(library.collections.length, 3);
});

test('The saved state survives reloading; unknown presets drop out', () => {
  const library = new PresetLibrary();
  const id = library.createCollection('Party');
  library.toggle(id, 'Geiss - Reaction');
  library.toggle(id, 'No longer exists');
  library.toggleFavorite('_Mig_049');
  library.setActive(id);
  const restored = new PresetLibrary(JSON.parse(JSON.stringify(library.toJSON())));
  assert.equal(restored.active, id);
  assert.ok(restored.isFavorite('_Mig_049'));
  assert.deepEqual(restored.namesOf(id, names), ['Geiss - Reaction']);
});

test('A broken saved state does not cause a crash', () => {
  const library = new PresetLibrary({ favorites: 'x', collections: [null, { id: 'a' }], active: 'weg' });
  assert.equal(library.active, ALL);
  assert.deepEqual(library.favorites, []);
  assert.equal(library.collections.length, 3);
});

test('"Own" shows the presets from the presets folder and is not saved', () => {
  const saved = [];
  const library = new PresetLibrary({}, { save: (data) => saved.push(data) });
  let notified = 0;
  library.onChange(() => notified++);
  assert.ok(library.collections.some((entry) => entry.id === OWN && entry.builtIn));
  library.setActive(OWN);
  assert.deepEqual(library.pool(names), { names: [...names], fallback: true });
  library.setOwn(['b eigenes', 'a eigenes']);
  library.setOwn(['a eigenes', 'b eigenes']);
  assert.equal(notified, 2); // setActive and the first setOwn; the second changes nothing
  assert.deepEqual(library.namesOf(OWN, [...names, 'a eigenes', 'b eigenes']), ['a eigenes', 'b eigenes']);
  assert.equal(library.toggle(OWN, 'Geiss - Reaction'), false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].own, undefined);
});

test('Backup: importing adds without deleting anything', () => {
  const source = new PresetLibrary();
  source.toggleFavorite('A');
  source.toggleFavorite('B');
  const id = source.createCollection('Party');
  source.toggle(id, 'C');
  const backup = JSON.parse(JSON.stringify(source.toBackup()));

  let saved = 0;
  const target = new PresetLibrary({ favorites: ['B', 'Z'], collections: [{ id: 'x', name: 'Party', presets: ['D'] }] }, { save: () => saved++ });
  assert.deepEqual(target.merge(backup), { favorites: 1, collections: 0, entries: 1 });
  assert.deepEqual(target.favorites, ['B', 'Z', 'A']);
  assert.deepEqual(target.custom.find((entry) => entry.name === 'Party').presets, ['D', 'C']);
  assert.equal(saved, 1);
  // Importing twice changes nothing more.
  assert.deepEqual(target.merge(backup), { favorites: 0, collections: 0, entries: 0 });
  assert.equal(saved, 1);
  // A new collection is added.
  const empty = new PresetLibrary();
  assert.deepEqual(empty.merge(backup), { favorites: 2, collections: 1, entries: 1 });
  assert.throws(() => empty.merge({ favorites: [] }), /not a backup/);
  // Backups from earlier versions had another kind.
  const old = new PresetLibrary();
  assert.deepEqual(old.merge({ ...backup, kind: 'equalizer-sammlungen' }), { favorites: 2, collections: 1, entries: 1 });
});

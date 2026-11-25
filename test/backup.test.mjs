import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window ??= {};
const { BACKUP_KIND, backupFileName, createBackup, parseBackup, restoreBackup } = await import('../src/backup/backup.js');

// chrome.storage.local in memory, with the promise API.
function memoryStorage(initial = {}) {
  let data = structuredClone(initial);
  return {
    async get(keys) {
      if (keys === null) return structuredClone(data);
      return Object.fromEntries([keys].flat().filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) {
      data = { ...data, ...structuredClone(values) };
    },
    async clear() {
      data = {};
    },
    get data() {
      return data;
    },
  };
}
function memoryPresets(files = [], state = 'browser') {
  const stored = new Map(files.map((file) => [`${file.folder}/${file.fileName}`, file]));
  return {
    state,
    async list() {
      return [...stored.values()].map(({ folder, fileName, text }) => ({ folder, fileName, text }));
    },
    async read(entry) {
      return entry.text;
    },
    async write(folder, fileName, text) {
      stored.set(`${folder}/${fileName}`, { folder, fileName, text });
    },
    get files() {
      return [...stored.values()];
    },
  };
}

const MILK = '[preset00]\nfDecay=0.98\nzoom=1.01\n';
const STORAGE = {
  hud: { pinned: true, keys: false, values: { audio: { volume: 60 } } },
  language: 'de',
  presetLibrary: { favorites: ['A'], collections: [{ id: 'c1', name: 'Chill', names: ['B'] }] },
  visconfs: [{ id: 'v1', name: 'Set', song: { title: 'Song' }, cues: [] }],
};

test('A backup holds the whole storage and the own presets, and brings them back into an empty extension', async () => {
  const backup = await createBackup({ storage: memoryStorage(STORAGE), customStore: memoryPresets([{ folder: 'own', fileName: 'Mine.milk', text: MILK }]), extensionVersion: '0.1.2' });
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.presetsIncluded, true);
  const text = JSON.stringify(backup);

  const storage = memoryStorage({ hud: { pinned: false }, leftover: 1 });
  const presets = memoryPresets([]);
  const result = await restoreBackup(parseBackup(text), { storage, customStore: presets });
  assert.deepEqual(storage.data, STORAGE, 'storage is exactly the backup, without leftovers');
  assert.deepEqual(presets.files, [{ folder: 'own', fileName: 'Mine.milk', text: MILK }]);
  assert.deepEqual(result, { keys: 4, presets: 1, presetsSkipped: 0 });
});

test('Without access to the presets folder, the backup says that the presets are missing', async () => {
  const backup = await createBackup({ storage: memoryStorage(STORAGE), customStore: memoryPresets([{ folder: 'own', fileName: 'Mine.milk', text: MILK }], 'prompt') });
  assert.equal(backup.presetsIncluded, false);
  assert.deepEqual(backup.presets, []);
});

test('Wrong or broken files are refused before anything changes', async () => {
  assert.throws(() => parseBackup('no json'), /not-json/);
  assert.throws(() => parseBackup(JSON.stringify({ kind: 'butterglow-visconfs', version: 1 })), /not-backup/);
  assert.throws(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 99, storage: {} })), /too-new/);
  assert.throws(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, storage: [] })), /broken/);
  const evil = { kind: BACKUP_KIND, version: 1, storage: {}, presets: [{ folder: 'own', fileName: '../escape.milk', text: MILK }] };
  assert.throws(() => parseBackup(JSON.stringify(evil)), /broken/, 'no paths outside the preset folders');
  const notMilk = { kind: BACKUP_KIND, version: 1, storage: {}, presets: [{ folder: 'own', fileName: 'x.milk', text: 'hello' }] };
  assert.throws(() => parseBackup(JSON.stringify(notMilk)), /broken/);
  assert.match(backupFileName(new Date('2026-11-24T10:00:00Z')), /^butterglow-backup-2026-11-24\.json$/);
});

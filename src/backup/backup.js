// Backup of everything ButterGlow keeps, as one file: all of the extension's storage (settings, language, equalizer,
// favourites and collections, visconfs with analyses and markers) and the own and edited presets.
//
// The presets live in a folder chosen by the user, or, where the browser allows no folder access (Brave), in the
// extension's own IndexedDB. The latter is empty after removing the extension, so the backup matters most there.
//
// Reading a backup first checks the whole file. Only if everything is fine does it replace the storage and write the
// presets, so a wrong or broken file changes nothing.

import { FOLDERS } from '../milk/custom-store.js';
import { looksLikeMilk } from '../milk/custom-presets.js';

export const BACKUP_KIND = 'butterglow-backup';
export const BACKUP_VERSION = 1;
const MAX_FILE_NAME = 200;

export const backupFileName = (date = new Date()) => `butterglow-backup-${date.toISOString().slice(0, 10)}.json`;

// `storage`: chrome.storage.local (or the same promise API in tests). `customStore`: custom-store.js, may be null.
// Presets are only included if the store can read them right now (folder connected, or the browser storage).
export async function createBackup({ storage, customStore = null, extensionVersion = '' }) {
  const data = await storage.get(null);
  const presets = [];
  let presetsIncluded = false;
  if (customStore && ['connected', 'browser'].includes(customStore.state)) {
    presetsIncluded = true;
    for (const entry of await customStore.list()) {
      presets.push({ folder: entry.folder, fileName: entry.fileName, text: await customStore.read(entry) });
    }
  }
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, created: new Date().toISOString(), extensionVersion, storage: data, presetsIncluded, presets };
}

// Checks a backup file. Returns the clean backup or throws Error('not-json' | 'not-backup' | 'too-new' | 'broken').
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  if (data?.kind !== BACKUP_KIND) throw new Error('not-backup');
  if (!(data.version >= 1)) throw new Error('broken');
  if (data.version > BACKUP_VERSION) throw new Error('too-new');
  if (!data.storage || typeof data.storage !== 'object' || Array.isArray(data.storage)) throw new Error('broken');
  const presets = Array.isArray(data.presets) ? data.presets : [];
  for (const preset of presets) {
    const fine =
      FOLDERS.includes(preset?.folder) &&
      typeof preset.fileName === 'string' &&
      /^[^/\\]{1,200}\.milk$/i.test(preset.fileName) &&
      preset.fileName.length <= MAX_FILE_NAME &&
      typeof preset.text === 'string' &&
      looksLikeMilk(preset.text);
    if (!fine) throw new Error('broken');
  }
  return { ...data, presets };
}

// Replaces the whole storage with the backup and writes its presets. `customStore` must be able to write
// (connected or browser storage) if the backup contains presets; otherwise they are skipped and counted.
// Returns { keys, presets, presetsSkipped }.
export async function restoreBackup(backup, { storage, customStore = null }) {
  const canWrite = customStore && ['connected', 'browser'].includes(customStore.state);
  await storage.clear();
  await storage.set(backup.storage);
  let written = 0;
  if (canWrite) {
    for (const { folder, fileName, text } of backup.presets) {
      await customStore.write(folder, fileName, text);
      written++;
    }
  }
  return { keys: Object.keys(backup.storage).length, presets: written, presetsSkipped: backup.presets.length - written };
}

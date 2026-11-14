// Own presets from a folder on disk: read, convert, save.
// Each entry remembers folder and file, so saving again overwrites the same file.
import { t } from '../i18n/i18n.js';
import { EDITED_FOLDER, OWN_FOLDER } from './custom-store.js';
import { fileNameFor, nameFromFile, parseMilk, serializeMilk } from './milk-format.js';

export const EDITED_SUFFIX = ' (edited)';
const OLD_EDITED_SUFFIX = ' (bearbeitet)'; // earlier versions; such files are saved back in place

// Rough check when opening: a [preset00] section or typical keys of a .milk file.
const looksLikeMilk = (text) => /^\s*\[preset\d*\]/im.test(text) || /^\s*(MILKDROP_PRESET_VERSION|fDecay|zoom|per_frame_1)\s*=/im.test(text);

export function createCustomPresets(store) {
  const entries = new Map(); // Name → { preset, folder, fileName, basedOn, warnings }
  const listeners = new Set();
  const newNames = new Set(); // newly created, not saved yet: target is own/
  let lastError = null;

  function changed() {
    for (const listener of listeners) listener();
  }

  async function scan() {
    entries.clear();
    lastError = null;
    try {
      for (const entry of await store.list()) {
        const name = nameFromFile(entry.fileName);
        try {
          const { preset, basedOn, warnings } = parseMilk(await store.read(entry));
          entries.set(name, { preset, folder: entry.folder, fileName: entry.fileName, basedOn, warnings });
          for (const warning of warnings) console.warn(`${entry.folder}/${entry.fileName}: ${warning}`);
        } catch (error) {
          console.warn(`${entry.folder}/${entry.fileName} could not be read:`, error);
        }
      }
    } catch (error) {
      lastError = error;
      console.warn('The folder for own presets could not be read:', error);
    }
    changed();
  }

  return {
    store,
    get state() {
      return store.state;
    },
    get folderName() {
      return store.folderName;
    },
    get lastError() {
      return lastError;
    },
    get names() {
      return [...entries.keys()];
    },
    get(name) {
      return entries.get(name) ?? null;
    },
    has: (name) => entries.has(name),
    // A new preset from a template that has not been saved yet.
    registerNew(name) {
      newNames.add(name);
    },
    isNew: (name) => newNames.has(name) && !entries.has(name),
    // Name → preset, for the visualizer's list.
    presetMap() {
      return Object.fromEntries([...entries].map(([name, { preset }]) => [name, preset]));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // At startup: read the remembered folder without asking.
    async restore() {
      if (await store.restore()) await scan();
      else changed(); // report the state (such as 'prompt') for the display
    },
    // From a click: connect or confirm the folder, then read.
    async connect(options) {
      await store.connect(options);
      await scan();
    },
    reload: scan,
    // Where a preset is saved: own presets into their file, bundled ones as a variation into edited/.
    // An existing variation (also one with the old German suffix) is overwritten instead of creating a second one.
    targetFor(name) {
      const own = entries.get(name);
      if (own) return { name, folder: own.folder, fileName: own.fileName, basedOn: own.basedOn };
      if (newNames.has(name)) return { name, folder: OWN_FOLDER, fileName: fileNameFor(name), basedOn: null };
      const oldTarget = `${name}${OLD_EDITED_SUFFIX}`;
      const target = entries.has(oldTarget) && !entries.has(`${name}${EDITED_SUFFIX}`) ? oldTarget : `${name}${EDITED_SUFFIX}`;
      const existing = entries.get(target);
      return { name: target, folder: existing?.folder ?? EDITED_FOLDER, fileName: existing?.fileName ?? fileNameFor(target), basedOn: name };
    },
    // Writes the preset and adds it to the list. Returns the target { name, folder, fileName, overwritten }.
    async save(name, preset) {
      const target = this.targetFor(name);
      const overwritten = entries.has(target.name);
      const text = serializeMilk(preset, { basedOn: target.basedOn });
      await store.write(target.folder, target.fileName, text);
      entries.set(target.name, { preset: structuredClone(preset), folder: target.folder, fileName: target.fileName, basedOn: target.basedOn, warnings: [] });
      changed();
      return { ...target, overwritten, text };
    },
    // Takes over .milk files, for example from "Open files" (File objects). Variations (with butterchurn_based_on)
    // go to edited/, all others to own/. Files with the same name are replaced.
    // Returns { imported: [names], failed: [{ fileName, message }] }.
    async importFiles(files) {
      const imported = [];
      const failed = [];
      for (const file of files) {
        const fileName = /\.milk$/i.test(file.name) ? file.name : `${file.name}.milk`;
        try {
          const text = await file.text();
          if (!looksLikeMilk(text)) throw new Error(t('store.notMilk'));
          const { basedOn } = parseMilk(text);
          await store.write(basedOn ? EDITED_FOLDER : OWN_FOLDER, fileName, text);
          imported.push(nameFromFile(fileName));
        } catch (error) {
          failed.push({ fileName: file.name, message: error.message });
        }
      }
      if (imported.length) await scan();
      return { imported, failed };
    },
  };
}

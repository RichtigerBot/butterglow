// Favourites and own collections for presets. Pure logic without UI; saving goes through `save`.
// A collection is an ordered list of preset names. "All", "Favourites" and "Own" always exist.
import { t } from '../i18n/i18n.js';

export const ALL = 'all';
export const FAVORITES = 'favorites';
export const OWN = 'own'; // own presets from the presets folder; not saved but read at startup
const MAX_NAME_LENGTH = 40;
export const BACKUP_KIND = 'butterglow-collections';
const OLD_BACKUP_KINDS = ['equalizer-sammlungen']; // backups from earlier versions can still be restored
export const BACKUP_FILE = 'butterglow-collections.json';

// "Flexi - mindblob [shiny mix]" → author "Flexi", title "mindblob [shiny mix]". Without " - " there is no author.
// Many names start with "_" so they appear at the top in Milkdrop. That is dropped for display.
export function parsePresetName(name) {
  const separator = name.indexOf(' - ');
  if (separator <= 0) return { title: name, author: '' };
  return { title: name.slice(separator + 3), author: name.slice(0, separator).replace(/^_+/, '') };
}

function cleanName(name) {
  return String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
}

export class PresetLibrary {
  constructor(stored = {}, { save = () => {} } = {}) {
    this.save = save;
    this.favorites = Array.isArray(stored.favorites) ? [...new Set(stored.favorites)] : [];
    this.custom = Array.isArray(stored.collections)
      ? stored.collections
          .filter((collection) => collection?.id && cleanName(collection.name))
          .map(({ id, name, presets }) => ({ id: String(id), name: cleanName(name), presets: [...new Set(presets ?? [])] }))
      : [];
    this.own = [];
    this.activeId = this.#exists(stored.active) ? stored.active : ALL;
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #changed() {
    this.save(this.toJSON());
    for (const listener of this.listeners) listener(this);
  }

  #exists(id) {
    return id === ALL || id === FAVORITES || id === OWN || this.custom.some((collection) => collection.id === id);
  }

  #list(id) {
    if (id === FAVORITES) return this.favorites;
    if (id === OWN) return this.own;
    return this.custom.find((collection) => collection.id === id)?.presets ?? null;
  }

  // For the selection: built-in ones first, then own ones in the order they were created.
  get collections() {
    return [
      { id: ALL, name: t('library.all'), builtIn: true },
      { id: FAVORITES, name: t('library.favorites'), builtIn: true },
      { id: OWN, name: t('library.own'), builtIn: true },
      ...this.custom.map(({ id, name }) => ({ id, name, builtIn: false })),
    ];
  }

  get customCollections() {
    return this.custom.map(({ id, name }) => ({ id, name }));
  }

  isFavorite(name) {
    return this.favorites.includes(name);
  }

  toggleFavorite(name) {
    return this.toggle(FAVORITES, name);
  }

  contains(id, name) {
    if (id === ALL) return true;
    return this.#list(id)?.includes(name) ?? false;
  }

  // Names of the own presets. Changes nothing that is saved, but reports the change so lists update.
  setOwn(names) {
    const next = [...names].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
    if (next.length === this.own.length && next.every((name, i) => name === this.own[i])) return;
    this.own = next;
    for (const listener of this.listeners) listener(this);
  }

  // Adds or removes a preset. Returns whether it is contained afterwards.
  toggle(id, name) {
    if (id === OWN) return this.contains(id, name);
    const list = this.#list(id);
    if (!list) return false;
    const index = list.indexOf(name);
    if (index >= 0) list.splice(index, 1);
    else list.push(name);
    this.#changed();
    return index < 0;
  }

  createCollection(name) {
    const clean = cleanName(name);
    if (!clean) return null;
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.custom.push({ id, name: clean, presets: [] });
    this.#changed();
    return id;
  }

  renameCollection(id, name) {
    const collection = this.custom.find((entry) => entry.id === id);
    const clean = cleanName(name);
    if (!collection || !clean) return false;
    collection.name = clean;
    this.#changed();
    return true;
  }

  deleteCollection(id) {
    const index = this.custom.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.custom.splice(index, 1);
    if (this.activeId === id) this.activeId = ALL;
    this.#changed();
    return true;
  }

  // Names of a collection that really exist. Unknown ones (for example after an update) drop out.
  namesOf(id, allNames) {
    if (id === ALL) return [...allNames];
    const known = new Set(allNames);
    return (this.#list(id) ?? []).filter((name) => known.has(name));
  }

  get active() {
    return this.activeId;
  }

  setActive(id) {
    if (!this.#exists(id) || id === this.activeId) return;
    this.activeId = id;
    this.#changed();
  }

  // What is played from. An empty collection plays all, so the picture never stands still.
  pool(allNames) {
    const names = this.namesOf(this.activeId, allNames);
    return names.length > 0 ? { names, fallback: false } : { names: [...allNames], fallback: this.activeId !== ALL };
  }

  // Backup as a file: favourites and collections, without the currently selected one.
  toBackup() {
    const { favorites, collections } = this.toJSON();
    return { kind: BACKUP_KIND, version: 1, savedAt: new Date().toISOString(), favorites, collections };
  }

  // Imports a backup without deleting anything: favourites are added, collections with the same name
  // are extended, the others created. Returns what was added. Throws on a foreign file.
  merge(backup) {
    if (![BACKUP_KIND, ...OLD_BACKUP_KINDS].includes(backup?.kind) || !Array.isArray(backup.favorites) || !Array.isArray(backup.collections)) {
      throw new Error(t('library.notBackup'));
    }
    let favorites = 0;
    let collections = 0;
    let entries = 0;
    for (const name of backup.favorites) {
      if (typeof name !== 'string' || this.favorites.includes(name)) continue;
      this.favorites.push(name);
      favorites++;
    }
    for (const incoming of backup.collections) {
      const name = cleanName(incoming?.name);
      if (!name) continue;
      let target = this.custom.find((entry) => entry.name === name);
      if (!target) {
        target = { id: incoming.id && !this.#exists(String(incoming.id)) ? String(incoming.id) : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, presets: [] };
        this.custom.push(target);
        collections++;
      }
      for (const preset of incoming.presets ?? []) {
        if (typeof preset !== 'string' || target.presets.includes(preset)) continue;
        target.presets.push(preset);
        entries++;
      }
    }
    if (favorites || collections || entries) this.#changed();
    return { favorites, collections, entries };
  }

  toJSON() {
    return { favorites: [...this.favorites], collections: this.custom.map((entry) => ({ ...entry, presets: [...entry.presets] })), active: this.activeId };
  }
}

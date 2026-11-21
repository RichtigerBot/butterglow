// Saves visconfs and song analyses in the extension's storage (chrome.storage.local, about 10 MB).
// A waveform takes about 15 kB per song, so several hundred songs fit.
// Analyses are stored once per song (songKey) and shared by all visconfs of that song.

import { normalizeVisconf, sameSong, songKey } from './visconf-model.js';

const VISCONFS_KEY = 'visconfs';
const ANALYSES_KEY = 'songAnalyses';

// `area`: chrome.storage.local, or anything with the same promise-based get/set for tests.
export function createVisconfStore(area = globalThis.chrome?.storage?.local) {
  const read = async (key, fallback) => (await area.get(key))[key] ?? fallback;
  const write = (key, value) => area.set({ [key]: value });

  const all = async () => (await read(VISCONFS_KEY, [])).map(normalizeVisconf).filter(Boolean);

  return {
    all,

    // The visconfs of a song, newest change first.
    async forSong(song) {
      return (await all()).filter((visconf) => sameSong(visconf.song, song)).sort((a, b) => b.updated - a.updated);
    },

    // Adds or replaces (same id).
    async save(visconf) {
      const clean = normalizeVisconf(visconf);
      if (!clean) throw new Error('invalid visconf');
      const list = (await all()).filter((entry) => entry.id !== clean.id);
      await write(VISCONFS_KEY, [...list, clean]);
      return clean;
    },

    async remove(id) {
      await write(VISCONFS_KEY, (await all()).filter((entry) => entry.id !== id));
    },

    async analysisFor(song) {
      return (await read(ANALYSES_KEY, {}))[songKey(song)] ?? null;
    },

    async saveAnalysis(song, analysis) {
      const analyses = await read(ANALYSES_KEY, {});
      await write(ANALYSES_KEY, { ...analyses, [songKey(song)]: analysis });
    },

    async analyses() {
      return read(ANALYSES_KEY, {});
    },

    // From an import file: visconfs with the same id are replaced, analyses only added where none exists yet.
    async merge({ visconfs = [], analyses = {} }) {
      const incoming = visconfs.map(normalizeVisconf).filter(Boolean);
      const ids = new Set(incoming.map((visconf) => visconf.id));
      await write(VISCONFS_KEY, [...(await all()).filter((entry) => !ids.has(entry.id)), ...incoming]);
      await write(ANALYSES_KEY, { ...analyses, ...(await read(ANALYSES_KEY, {})) });
      return incoming.length;
    },
  };
}

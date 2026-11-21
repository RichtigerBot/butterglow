// Saves visconfs and song analyses in the extension's storage (chrome.storage.local, about 10 MB).
// A waveform takes about 15 kB per song, so several hundred songs fit.
// Analyses and markers are stored once per song (songKey) and shared by all visconfs of that song.
// The markers start from the analysis and keep the changes made by hand, also when the song is analysed again.

import { markersFromAnalysis, normalizeMarkers, refreshMarkers } from './song-markers.js';
import { normalizeVisconf, sameSong, songKey } from './visconf-model.js';

const VISCONFS_KEY = 'visconfs';
const ANALYSES_KEY = 'songAnalyses';
const MARKERS_KEY = 'songMarkers';

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

    // Saves a new analysis. Markers already there keep their hand-made changes.
    async saveAnalysis(song, analysis) {
      const key = songKey(song);
      const analyses = await read(ANALYSES_KEY, {});
      const markers = await read(MARKERS_KEY, {});
      const existing = normalizeMarkers(markers[key]);
      await write(ANALYSES_KEY, { ...analyses, [key]: analysis });
      await write(MARKERS_KEY, { ...markers, [key]: existing ? refreshMarkers(existing, analysis) : markersFromAnalysis(analysis) });
    },

    // The markers of a song, or null if it was never analysed.
    async markersFor(song) {
      const key = songKey(song);
      const stored = normalizeMarkers((await read(MARKERS_KEY, {}))[key]);
      if (stored) return stored;
      const analysis = (await read(ANALYSES_KEY, {}))[key];
      return analysis ? markersFromAnalysis(analysis) : null;
    },

    async saveMarkers(song, markers) {
      const clean = normalizeMarkers(markers);
      if (!clean) throw new Error('invalid markers');
      await write(MARKERS_KEY, { ...(await read(MARKERS_KEY, {})), [songKey(song)]: clean });
      return clean;
    },

    // Back to the automatic markers of the analysis; all hand-made changes are gone.
    async resetMarkers(song) {
      const key = songKey(song);
      const analysis = (await read(ANALYSES_KEY, {}))[key];
      if (!analysis) return null;
      const markers = markersFromAnalysis(analysis);
      await write(MARKERS_KEY, { ...(await read(MARKERS_KEY, {})), [key]: markers });
      return markers;
    },

    async markers() {
      return read(MARKERS_KEY, {});
    },

    async analyses() {
      return read(ANALYSES_KEY, {});
    },

    // From an import file: visconfs with the same id are replaced, analyses only added where none exists yet.
    // Imported markers replace the ones here: they are someone's hand-made work for that song.
    async merge({ visconfs = [], analyses = {}, markers = {} }) {
      const incoming = visconfs.map(normalizeVisconf).filter(Boolean);
      const ids = new Set(incoming.map((visconf) => visconf.id));
      await write(VISCONFS_KEY, [...(await all()).filter((entry) => !ids.has(entry.id)), ...incoming]);
      await write(ANALYSES_KEY, { ...analyses, ...(await read(ANALYSES_KEY, {})) });
      await write(MARKERS_KEY, { ...(await read(MARKERS_KEY, {})), ...markers });
      return incoming.length;
    },
  };
}

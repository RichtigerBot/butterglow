// Visconfs: a planned sequence of preset changes for one song, for videos or DJ sets that should look the same
// every time. A song can have several visconfs.
//
// A visconf is a list of cues. Each cue starts a section at a position in the song, which lasts until the next
// cue. It says which preset comes (a fixed one, or a random one from all presets or a collection) and how
// (hard cut, or soft cross-fade, which suits quiet parts). All functions here are pure: they return new objects.

import { normalizeMarkers } from './song-markers.js';

export const FILE_KIND = 'butterglow-visconfs';
export const FILE_VERSION = 1;
export const FILE_NAME = 'butterglow-visconfs.json';
export const TRANSITIONS = ['cut', 'soft'];
export const ORIGINS = ['drop', 'quiet', 'manual', 'live'];
export const ALL_PRESETS = 'all'; // same id as the "All" collection in the preset library
const DURATION_TOLERANCE_SECONDS = 3; // the same song on another site is often a few seconds longer or shorter
const SNAP_SECONDS = 0.25;
const NAME_MAX = 80;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const round = (value) => Math.round(value * 1000) / 1000;
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

// Lower case, without accents, extra spaces or additions like "(Official Video)", so that the same song is found
// again on another site.
export function normalizeTitle(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([](official|offizielles|lyrics?|audio|video|hd|hq|4k|visuali[sz]er|music video)[^)\]]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The song a visconf belongs to. `duration` in seconds, 0 if unknown.
export function songOf({ title, artist, duration } = {}) {
  return { title: text(title), artist: text(artist), duration: Number.isFinite(duration) && duration > 0 ? round(duration) : 0 };
}

// "Artist - Title (Official Video).mp3" → { artist, title }; without " - " everything is the title.
export function songFromFileName(name) {
  const base = String(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_][A-Za-z0-9_-]{11}$/, ''); // YouTube id at the end
  const split = base.indexOf(' - ');
  return split > 0 ? { artist: base.slice(0, split).trim(), title: base.slice(split + 3).trim() } : { artist: '', title: base.trim() };
}

export function songKey(song) {
  return `${normalizeTitle(song.artist)}|${normalizeTitle(song.title)}`;
}

// Same title and artist, and, if both durations are known, about the same length (radio edit vs. extended mix).
export function sameSong(a, b) {
  if (songKey(a) !== songKey(b) || !normalizeTitle(a.title)) return false;
  return !a.duration || !b.duration || Math.abs(a.duration - b.duration) <= DURATION_TOLERANCE_SECONDS;
}

// Which preset a cue starts: { mode: 'fixed', name } or { mode: 'random', pool } with a collection id.
export function normalizePreset(preset) {
  if (preset?.mode === 'fixed' && text(preset.name)) return { mode: 'fixed', name: text(preset.name) };
  return { mode: 'random', pool: text(preset?.pool, 100) || ALL_PRESETS };
}

export function normalizeCue(cue) {
  const time = Number(cue?.time);
  if (!Number.isFinite(time) || time < 0) return null;
  return {
    id: text(cue.id, 100) || newId(),
    time: round(time),
    preset: normalizePreset(cue.preset),
    transition: TRANSITIONS.includes(cue.transition) ? cue.transition : 'cut',
    origin: ORIGINS.includes(cue.origin) ? cue.origin : 'manual',
    label: text(cue.label, NAME_MAX),
    marker: text(cue.marker, 100), // id of the drop or quiet part the cue follows, '' if none
  };
}

const sortCues = (cues) => cues.filter(Boolean).sort((a, b) => a.time - b.time);

// Returns a clean visconf or null. Used for everything that comes from storage or a file.
export function normalizeVisconf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const song = songOf(raw.song);
  if (!song.title) return null;
  const duration = song.duration || Infinity;
  return {
    id: text(raw.id, 100) || newId(),
    name: text(raw.name, NAME_MAX) || 'Visconf',
    song,
    cues: sortCues((Array.isArray(raw.cues) ? raw.cues : []).map(normalizeCue)).filter((cue) => cue.time <= duration),
    updated: Number.isFinite(raw.updated) ? raw.updated : Date.now(),
  };
}

export function createVisconf({ name, song, cues = [] }) {
  return normalizeVisconf({ id: newId(), name, song, cues, updated: Date.now() });
}

const changed = (visconf, cues) => ({ ...visconf, cues: sortCues(cues), updated: Date.now() });

export function addCue(visconf, cue) {
  const clean = normalizeCue(cue);
  return clean ? changed(visconf, [...visconf.cues, clean]) : visconf;
}

// `changes`: any cue fields, e.g. { time } to move it or { preset } to choose another preset.
export function updateCue(visconf, id, changes) {
  return changed(
    visconf,
    visconf.cues.map((cue) => (cue.id === id ? (normalizeCue({ ...cue, ...changes, id }) ?? cue) : cue)),
  );
}

export function removeCue(visconf, id) {
  return changed(visconf, visconf.cues.filter((cue) => cue.id !== id));
}

// The cue whose section contains `position`, or null before the first cue.
export function cueAt(visconf, position) {
  let found = null;
  for (const cue of visconf.cues) if (cue.time <= position) found = cue;
  return found;
}

// Moves a hand-set time onto the nearest beat if one is close enough (`beats` sorted, in seconds).
export function snapToBeat(time, beats, maxDistance = SNAP_SECONDS) {
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (beats[middle] < time) low = middle + 1;
    else high = middle;
  }
  let best = null;
  for (const candidate of [beats[low - 1], beats[low]]) {
    if (candidate === undefined || Math.abs(candidate - time) > maxDistance) continue;
    if (best === null || Math.abs(candidate - time) < Math.abs(best - time)) best = candidate;
  }
  return best ?? time;
}

// The points where markers want a change: every drop (hard cut) and the start of every quiet part (soft).
const markerPoints = (markers) => [
  ...(markers?.drops ?? []).map(({ id, time }) => ({ id, time, origin: 'drop', transition: 'cut' })),
  ...(markers?.quiet ?? []).map(({ id, start }) => ({ id, time: start, origin: 'quiet', transition: 'soft' })),
];
const cueForPoint = ({ id, time, origin, transition }, pool) => normalizeCue({ time, preset: { mode: 'random', pool }, transition, origin, marker: id });

// A first draft from the song markers (song-markers.js, possibly edited by hand): a hard cut on every drop,
// a soft change at the start of every quiet part, each with a random preset from `pool`. Each cue follows its marker.
export function cuesFromMarkers(markers, { pool = ALL_PRESETS } = {}) {
  return sortCues(markerPoints(markers).map((point) => cueForPoint(point, pool)));
}

// The marker a cue follows: by id, or for cues saved before the link existed, a draft cue at the marker's time.
function linkedPoint(cue, points) {
  if (cue.marker) return points.find((point) => point.id === cue.marker) ?? null;
  return points.find((point) => point.origin === cue.origin && Math.abs(point.time - cue.time) < 0.01) ?? null;
}

// After the markers changed from `before` to `after`: cues of a marker move with it and go when it is deleted, and
// every new marker gets a cue of its own. Returns the same visconf if nothing changed.
export function followMarkers(visconf, before, after, { pool = ALL_PRESETS } = {}) {
  if (!visconf || before === after) return visconf;
  const old = markerPoints(before);
  const now = new Map(markerPoints(after).map((point) => [point.id, point]));
  const known = new Set(old.map((point) => point.id));
  let touched = false;
  const cues = [];
  for (const cue of visconf.cues) {
    const link = linkedPoint(cue, old);
    if (!link) {
      cues.push(cue);
      continue;
    }
    const point = now.get(link.id);
    if (!point) {
      touched = true; // its marker was deleted
      continue;
    }
    if (point.time !== cue.time || cue.marker !== link.id) touched = true;
    cues.push({ ...cue, time: point.time, marker: link.id });
  }
  for (const point of now.values()) {
    if (known.has(point.id)) continue;
    cues.push(cueForPoint(point, pool));
    touched = true;
  }
  return touched ? changed(visconf, cues) : visconf;
}

// Export file: the visconfs and, if given, the song analyses and markers (both keyed by songKey), so waveform and
// hand-edited markers are there on another computer too.
export function toFile(visconfs, analyses = {}, markers = {}) {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, visconfs: visconfs.map(normalizeVisconf).filter(Boolean), analyses, markers }, null, 1);
}

// Returns { visconfs, analyses, markers }. Throws if the text is not a visconf file; skips single broken entries.
export function fromFile(textContent) {
  let data;
  try {
    data = JSON.parse(textContent);
  } catch {
    throw new Error('not-json');
  }
  if (data?.kind !== FILE_KIND || !Array.isArray(data.visconfs)) throw new Error('not-visconfs');
  if (data.version > FILE_VERSION) throw new Error('too-new');
  const analyses = {};
  for (const [key, analysis] of Object.entries(data.analyses ?? {})) {
    if (analysis && Array.isArray(analysis.waveform?.peaks) && Number.isFinite(analysis.duration)) analyses[key] = analysis;
  }
  const markers = {};
  for (const [key, entry] of Object.entries(data.markers ?? {})) {
    const clean = normalizeMarkers(entry);
    if (clean) markers[key] = clean;
  }
  return { visconfs: data.visconfs.map(normalizeVisconf).filter(Boolean), analyses, markers };
}

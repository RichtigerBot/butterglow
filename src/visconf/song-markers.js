// Editable markers of a song: drops, quiet parts and the beat grid. They start from the analysis and can then
// be moved, changed, deleted and added by hand. The markers belong to the song, so all of its visconfs share them.
//
// - Drops: points in time.
// - Quiet parts: ranges with start and end.
// - Beat grid: tempo and the time of one beat (`offset`). Single beats are not stored: dragging hundreds of beats
//   one by one would be tedious. The grid can be set by number, by tapping, or moved as a whole.
//
// Everything edited by hand is marked `manual`. A new analysis replaces only the automatic markers, and automatic
// markers deleted by hand stay deleted. All functions are pure and return new objects.

const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_QUIET_SECONDS = 0.5;
const SAME_SPOT_SECONDS = 0.5; // a new analysis finds the same drop again within this distance
const TAP_RESET_SECONDS = 2; // a longer pause between taps starts a new measurement
const TAP_MIN = 4;
const TAP_KEEP = 16;
const REFINE_BPM = 1;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const round = (value) => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => Number.isFinite(Number(value));

// Time of the beat that lies within the first beat period, so the same grid always has the same offset.
function normalizeOffset(offset, bpm) {
  const period = 60 / bpm;
  return round(((offset % period) + period) % period);
}

// How well the kicks line up on a grid with this period: length of the average of all kick times on a circle
// of one period (1 = all exactly on the grid), and the phase of that average.
function fit(beats, period) {
  let x = 0;
  let y = 0;
  for (const time of beats) {
    const angle = (2 * Math.PI * time) / period;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return { strength: Math.hypot(x, y) / beats.length, phase: (Math.atan2(y, x) / (2 * Math.PI)) * period };
}

// A grid that fits the kicks. The detected tempo is only accurate to about 0.5 BPM, which over a whole song
// drifts by more than a beat. So it is refined in steps of 0.01 BPM within ±REFINE_BPM. Kicks off the beat
// (offbeats, fills) only weaken the fit a little; they do not move it.
export function gridFromBeats(beats, bpm) {
  if (!(bpm > 0) || beats.length === 0) return { bpm: bpm > 0 ? bpm : null, offset: 0, manual: false };
  let best = { bpm, ...fit(beats, 60 / bpm) };
  for (let step = -REFINE_BPM * 100; step <= REFINE_BPM * 100; step++) {
    const candidate = bpm + step / 100;
    const result = fit(beats, 60 / candidate);
    if (result.strength > best.strength) best = { bpm: candidate, ...result };
  }
  // A best fit at the edge of the range is no real optimum, just noise pulling outwards: keep the detected tempo.
  if (Math.abs(best.bpm - bpm) >= REFINE_BPM - 0.005) best = { bpm, ...fit(beats, 60 / bpm) };
  const tempo = round(best.bpm);
  return { bpm: tempo, offset: normalizeOffset(best.phase, tempo), manual: false };
}

// All beat times of the grid up to `duration`, for snapping and for drawing.
export function beatsOf(grid, duration) {
  if (!grid?.bpm) return [];
  const period = 60 / grid.bpm;
  const beats = [];
  for (let time = grid.offset; time <= duration; time += period) beats.push(round(time));
  return beats;
}

const drop = ({ id, time, strength = 1, manual = false }) => ({ id: id || newId(), time: round(Math.max(0, time)), strength: round(clamp(strength, 0, 1)), manual: Boolean(manual) });
const quiet = ({ id, start, end, manual = false }) => ({ id: id || newId(), start: round(Math.max(0, start)), end: round(Math.max(start + MIN_QUIET_SECONDS, end)), manual: Boolean(manual) });
const byTime = (list) => list.sort((a, b) => (a.time ?? a.start) - (b.time ?? b.start));

// Quiet parts from the analysis: ranges if it has them, otherwise only starts (older analyses), which then last
// until the next drop or the next quiet part, at most 8 s.
function quietFromAnalysis(analysis) {
  if (Array.isArray(analysis?.quietParts)) return analysis.quietParts.map(({ start, end }) => quiet({ start, end }));
  const starts = analysis?.quietStarts ?? [];
  const drops = (analysis?.drops ?? []).map(({ time }) => time);
  return starts.map((start, index) => {
    const next = Math.min(starts[index + 1] ?? Infinity, ...drops.filter((time) => time > start), start + 8);
    return quiet({ start, end: next });
  });
}

export function markersFromAnalysis(analysis) {
  return {
    duration: round(analysis?.duration ?? 0),
    drops: byTime((analysis?.drops ?? []).map((entry) => drop(entry))),
    quiet: byTime(quietFromAnalysis(analysis)),
    grid: gridFromBeats(analysis?.beats ?? [], analysis?.bpm ?? null),
    hidden: [], // times of automatic markers deleted by hand
  };
}

// Returns clean markers or null. For everything from storage or a file.
export function normalizeMarkers(raw) {
  if (!raw || typeof raw !== 'object' || !finite(raw.duration)) return null;
  const duration = round(Math.max(0, raw.duration));
  const bpm = Number(raw.grid?.bpm);
  return {
    duration,
    drops: byTime((Array.isArray(raw.drops) ? raw.drops : []).filter((entry) => finite(entry?.time)).map(drop)),
    quiet: byTime((Array.isArray(raw.quiet) ? raw.quiet : []).filter((entry) => finite(entry?.start) && finite(entry?.end)).map(quiet)),
    grid:
      bpm >= MIN_BPM && bpm <= MAX_BPM
        ? { bpm: round(bpm), offset: normalizeOffset(Number(raw.grid.offset) || 0, bpm), manual: Boolean(raw.grid.manual) }
        : { bpm: null, offset: 0, manual: false },
    hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).filter(finite).map(Number),
  };
}

const hide = (markers, entry) => (entry.manual ? markers.hidden : [...markers.hidden, entry.time ?? entry.start]);

// Drops.
export function addDrop(markers, time) {
  return { ...markers, drops: byTime([...markers.drops, drop({ time: Math.min(time, markers.duration), manual: true })]) };
}

export function moveDrop(markers, id, time) {
  return {
    ...markers,
    drops: byTime(markers.drops.map((entry) => (entry.id === id ? drop({ ...entry, time: clamp(time, 0, markers.duration), manual: true }) : entry))),
  };
}

export function removeDrop(markers, id) {
  const entry = markers.drops.find((candidate) => candidate.id === id);
  if (!entry) return markers;
  return { ...markers, drops: markers.drops.filter((candidate) => candidate !== entry), hidden: hide(markers, entry) };
}

// Quiet parts. `changes`: { start } and/or { end }, e.g. while dragging one edge, or both to move the whole range.
export function addQuiet(markers, start, end) {
  return { ...markers, quiet: byTime([...markers.quiet, quiet({ start, end: Math.min(end, markers.duration), manual: true })]) };
}

export function updateQuiet(markers, id, changes) {
  return {
    ...markers,
    quiet: byTime(
      markers.quiet.map((entry) => {
        if (entry.id !== id) return entry;
        const start = clamp(changes.start ?? entry.start, 0, markers.duration - MIN_QUIET_SECONDS);
        const end = clamp(changes.end ?? entry.end, start + MIN_QUIET_SECONDS, markers.duration);
        return quiet({ ...entry, start, end, manual: true });
      }),
    ),
  };
}

export function removeQuiet(markers, id) {
  const entry = markers.quiet.find((candidate) => candidate.id === id);
  if (!entry) return markers;
  return { ...markers, quiet: markers.quiet.filter((candidate) => candidate !== entry), hidden: hide(markers, entry) };
}

// Beat grid. The tempo changes around the beat at `anchor` (e.g. the first kick), so that one stays in place.
export function setTempo(markers, bpm, anchor = markers.grid.offset) {
  const clean = round(clamp(Number(bpm), MIN_BPM, MAX_BPM));
  if (!Number.isFinite(clean)) return markers;
  const period = markers.grid.bpm ? 60 / markers.grid.bpm : 60 / clean;
  const beat = markers.grid.bpm ? markers.grid.offset + Math.round((anchor - markers.grid.offset) / period) * period : anchor;
  return { ...markers, grid: { bpm: clean, offset: normalizeOffset(beat, clean), manual: true } };
}

// Moves the whole grid, e.g. by dragging one beat onto a kick: `from` is where the beat was grabbed, `to` where it is.
export function shiftGrid(markers, from, to) {
  if (!markers.grid.bpm) return markers;
  return { ...markers, grid: { ...markers.grid, offset: normalizeOffset(markers.grid.offset + (to - from), markers.grid.bpm), manual: true } };
}

// Puts a beat exactly at `time` (e.g. "the first kick is here") without changing the tempo.
export function setDownbeat(markers, time) {
  if (!markers.grid.bpm) return markers;
  return { ...markers, grid: { ...markers.grid, offset: normalizeOffset(time, markers.grid.bpm), manual: true } };
}

// After a new analysis: hand-edited markers stay, automatic ones come from the new analysis,
// and automatic ones deleted by hand stay deleted.
export function refreshMarkers(markers, analysis) {
  const fresh = markersFromAnalysis(analysis);
  const wasHidden = (time) => markers.hidden.some((hidden) => Math.abs(hidden - time) <= SAME_SPOT_SECONDS);
  const nearManual = (list, time) => list.some((entry) => entry.manual && Math.abs((entry.time ?? entry.start) - time) <= SAME_SPOT_SECONDS);
  return {
    duration: fresh.duration,
    drops: byTime([
      ...markers.drops.filter((entry) => entry.manual),
      ...fresh.drops.filter(({ time }) => !wasHidden(time) && !nearManual(markers.drops, time)),
    ]),
    quiet: byTime([
      ...markers.quiet.filter((entry) => entry.manual),
      ...fresh.quiet.filter(({ start }) => !wasHidden(start) && !nearManual(markers.quiet, start)),
    ]),
    grid: markers.grid.manual ? markers.grid : fresh.grid,
    hidden: markers.hidden,
  };
}

// Tap tempo: call `tap(seconds)` on every key press. Returns the tempo once there are enough taps, else null.
export function createTapTempo() {
  let taps = [];
  return {
    tap(now) {
      if (taps.length && now - taps[taps.length - 1] > TAP_RESET_SECONDS) taps = [];
      taps = [...taps, now].slice(-TAP_KEEP);
      if (taps.length < TAP_MIN) return null;
      // Least squares over all taps: steadier than the average of the intervals.
      const n = taps.length;
      const meanIndex = (n - 1) / 2;
      const meanTime = taps.reduce((sum, time) => sum + time, 0) / n;
      let covariance = 0;
      let variance = 0;
      taps.forEach((time, index) => {
        covariance += (index - meanIndex) * (time - meanTime);
        variance += (index - meanIndex) ** 2;
      });
      const period = covariance / variance;
      return period > 0 ? Math.round((60 / period) * 10) / 10 : null;
    },
    reset() {
      taps = [];
    },
    // The last tap, to place the grid on it with setDownbeat.
    get last() {
      return taps.at(-1) ?? null;
    },
  };
}

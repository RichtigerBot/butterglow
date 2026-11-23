// Geometry of the visconf timeline, without the DOM: which part of the song is visible, where a time is
// drawn, what lies under the mouse and what a drag changes. visconf-panel.js draws and handles the mouse.
//
// Lanes from top to bottom:
// - ruler: time and beat grid. Clicking seeks, dragging moves the beat grid.
// - wave: waveform, quiet parts (shaded) and drops (lines). Drag markers and edges; double-click adds a drop,
//   shift-drag draws a new quiet part.
// - cues: the visconf's preset changes and the sections between them. Double-click adds a change.

import { addCue, snapToBeat, updateCue } from './visconf-model.js';
import { addQuiet, beatsOf, moveDrop, shiftGrid, updateQuiet } from './song-markers.js';

export const LAYOUT = {
  ruler: { top: 0, bottom: 18 },
  wave: { top: 18, bottom: 98 },
  cues: { top: 102, bottom: 142 },
  height: 144,
};
const GRAB_PX = 6; // how close the mouse must be to a marker or an edge
const MIN_SPAN_SECONDS = 2;

export function laneAt(y) {
  for (const name of ['ruler', 'wave', 'cues']) if (y >= LAYOUT[name].top && y < LAYOUT[name].bottom) return name;
  return null;
}

// The visible part of the song in seconds.
export const fullView = (duration) => ({ start: 0, end: Math.max(duration, MIN_SPAN_SECONDS) });
export const timeToX = (view, width, time) => ((time - view.start) / (view.end - view.start)) * width;
export const xToTime = (view, width, x) => view.start + (x / width) * (view.end - view.start);

function clampView(start, span, duration) {
  const total = Math.max(duration, MIN_SPAN_SECONDS);
  const length = Math.min(total, Math.max(MIN_SPAN_SECONDS, span));
  const from = Math.min(Math.max(0, start), total - length);
  return { start: from, end: from + length };
}

// Zoom around `anchor` (the time under the mouse stays under the mouse). factor < 1 zooms in.
export function zoomView(view, duration, anchor, factor) {
  const span = (view.end - view.start) * factor;
  const ratio = (anchor - view.start) / (view.end - view.start);
  return clampView(anchor - ratio * span, span, duration);
}

export function scrollView(view, duration, seconds) {
  return clampView(view.start + seconds, view.end - view.start, duration);
}

// Keeps `time` visible, e.g. the playhead during playback: when it leaves the view, the view jumps a page.
export function followView(view, duration, time) {
  const span = view.end - view.start;
  if (time >= view.start && time <= view.end) return view;
  return clampView(time - span * 0.1, span, duration);
}

// What lies under the mouse. Returns { kind, id?, time } with the time under the mouse.
// kinds: 'cue', 'drop', 'quiet-start', 'quiet-end', 'quiet', 'ruler', 'wave', 'cues', or null outside the lanes.
export function hitTest({ markers, visconf, view, width, x, y }) {
  const time = xToTime(view, width, x);
  const lane = laneAt(y);
  const near = (at) => Math.abs(timeToX(view, width, at) - x) <= GRAB_PX;
  const closest = (list, timeOf) => {
    let best = null;
    for (const entry of list) {
      const distance = Math.abs(timeToX(view, width, timeOf(entry)) - x);
      if (distance <= GRAB_PX && (best === null || distance < best.distance)) best = { entry, distance };
    }
    return best?.entry ?? null;
  };
  if (lane === 'cues') {
    const cue = closest(visconf?.cues ?? [], (entry) => entry.time);
    return cue ? { kind: 'cue', id: cue.id, time } : { kind: 'cues', time };
  }
  if (lane === 'wave' && markers) {
    const drop = closest(markers.drops, (entry) => entry.time);
    if (drop) return { kind: 'drop', id: drop.id, time };
    for (const part of markers.quiet) {
      if (near(part.start)) return { kind: 'quiet-start', id: part.id, time };
      if (near(part.end)) return { kind: 'quiet-end', id: part.id, time };
    }
    const inside = markers.quiet.find((part) => time > part.start && time < part.end);
    return inside ? { kind: 'quiet', id: inside.id, time } : { kind: 'wave', time };
  }
  return lane ? { kind: lane, time } : null;
}

// Snaps to the beat grid if `snap` is on. Markers and cues land on beats this way; the grid itself never snaps.
export function snapTime(time, markers, snap) {
  if (!snap || !markers?.grid?.bpm) return time;
  const period = 60 / markers.grid.bpm;
  const nearby = beatsOf(markers.grid, time + period).filter((beat) => beat >= time - period);
  return snapToBeat(time, nearby, period / 2);
}

// What a drag changes. `start`: { markers, visconf } when the drag began (each move is applied to that state,
// so rounding does not add up), `hit`: what was grabbed, `from`/`to`: times at the start and now.
// Returns { markers, visconf }.
export function applyDrag({ markers, visconf }, hit, from, to, { snap = false, newQuiet = false } = {}) {
  const delta = to - from;
  const at = (time) => snapTime(time, markers, snap);
  switch (hit.kind) {
    case 'cue': {
      const cue = visconf.cues.find((entry) => entry.id === hit.id);
      // Moved by hand, the cue no longer follows its marker.
      return { markers, visconf: updateCue(visconf, hit.id, { time: Math.max(0, at(cue.time + delta)), marker: '', origin: 'manual' }) };
    }
    case 'drop': {
      const drop = markers.drops.find((entry) => entry.id === hit.id);
      return { markers: moveDrop(markers, hit.id, at(drop.time + delta)), visconf };
    }
    case 'quiet-start':
    case 'quiet-end': {
      const part = markers.quiet.find((entry) => entry.id === hit.id);
      const edge = hit.kind === 'quiet-start' ? 'start' : 'end';
      return { markers: updateQuiet(markers, hit.id, { [edge]: at(part[edge] + delta) }), visconf };
    }
    case 'quiet': {
      const part = markers.quiet.find((entry) => entry.id === hit.id);
      const start = at(part.start + delta);
      return { markers: updateQuiet(markers, hit.id, { start, end: start + (part.end - part.start) }), visconf };
    }
    case 'ruler':
      return { markers: shiftGrid(markers, from, to), visconf };
    case 'wave':
      if (!newQuiet || Math.abs(delta) < 0.1) return { markers, visconf };
      return { markers: addQuiet(markers, at(Math.min(from, to)), at(Math.max(from, to))), visconf };
    default:
      return { markers, visconf };
  }
}

// A new change at `time` in the cue lane: it takes over preset and transition from the section it splits,
// so splitting a section changes nothing until the new cue gets its own preset.
export function insertCue(visconf, time, { markers, snap = false } = {}) {
  const at = snapTime(time, markers, snap);
  let before = null;
  for (const cue of visconf.cues) if (cue.time <= at) before = cue;
  return addCue(visconf, { time: at, preset: before?.preset, transition: before?.transition ?? 'cut', origin: 'manual' });
}

export function formatTime(seconds) {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

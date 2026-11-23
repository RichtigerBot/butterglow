import assert from 'node:assert/strict';
import test from 'node:test';
import { markersFromAnalysis } from '../src/visconf/song-markers.js';
import { LAYOUT, applyDrag, followView, formatTime, fullView, hitTest, insertCue, scrollView, snapTime, timeToX, xToTime, zoomView } from '../src/visconf/timeline-geometry.js';
import { createVisconf, songFromFileName } from '../src/visconf/visconf-model.js';

const WIDTH = 1200; // 10 px per second for a 120 s song
const markers = markersFromAnalysis({
  duration: 120,
  drops: [{ time: 30, strength: 1 }],
  quietParts: [{ start: 60, end: 75 }],
  beats: [0, 0.5, 1, 1.5, 2],
  bpm: 120,
});
const visconf = createVisconf({ song: { title: 'Song', duration: 120 }, cues: [{ time: 10 }, { time: 50, transition: 'soft' }] });
const view = fullView(120);
const waveY = (LAYOUT.wave.top + LAYOUT.wave.bottom) / 2;
const cueY = (LAYOUT.cues.top + LAYOUT.cues.bottom) / 2;
const hit = (x, y) => hitTest({ markers, visconf, view, width: WIDTH, x, y });

test('Times and pixels convert both ways', () => {
  assert.equal(timeToX(view, WIDTH, 30), 300);
  assert.equal(xToTime(view, WIDTH, 300), 30);
});

test('Zooming keeps the time under the mouse in place and stays within the song', () => {
  const zoomed = zoomView(view, 120, 30, 0.5);
  assert.equal(zoomed.end - zoomed.start, 60);
  assert.ok(Math.abs(timeToX(zoomed, WIDTH, 30) - timeToX(view, WIDTH, 30)) < 1e-9);
  assert.deepEqual(zoomView(view, 120, 60, 2), { start: 0, end: 120 }, 'not wider than the song');
  assert.equal(zoomView(view, 120, 60, 0.0001).end - zoomView(view, 120, 60, 0.0001).start, 2, 'at least 2 s');
  assert.deepEqual(scrollView(zoomed, 120, 1000), { start: 60, end: 120 });
  assert.deepEqual(followView({ start: 0, end: 20 }, 120, 50), { start: 48, end: 68 });
  assert.deepEqual(followView({ start: 0, end: 20 }, 120, 10), { start: 0, end: 20 });
});

test('The mouse finds cues, drops, edges and ranges, with a few pixels of slack', () => {
  assert.deepEqual(hit(103, cueY).kind, 'cue');
  assert.equal(hit(103, cueY).id, visconf.cues[0].id);
  assert.equal(hit(200, cueY).kind, 'cues');
  assert.equal(hit(297, waveY).kind, 'drop');
  assert.equal(hit(602, waveY).kind, 'quiet-start');
  assert.equal(hit(749, waveY).kind, 'quiet-end');
  assert.equal(hit(680, waveY).kind, 'quiet');
  assert.equal(hit(400, waveY).kind, 'wave');
  assert.equal(hit(400, 5).kind, 'ruler');
  assert.equal(hit(400, 500), null);
});

test('Snapping lands on the nearest beat of the grid', () => {
  assert.equal(snapTime(30.2, markers, true), 30);
  assert.equal(snapTime(30.3, markers, true), 30.5);
  assert.equal(snapTime(30.2, markers, false), 30.2);
});

test('Dragging moves cues, drops, edges and whole ranges, relative to where the drag began', () => {
  const start = { markers, visconf };
  const cue = applyDrag(start, hit(100, cueY), 10, 15.2, { snap: true });
  assert.equal(cue.visconf.cues[0].time, 15);
  const drop = applyDrag(start, hit(300, waveY), 30, 40.1);
  assert.equal(drop.markers.drops[0].time, 40.1);
  assert.ok(drop.markers.drops[0].manual);
  const edge = applyDrag(start, hit(750, waveY), 75, 80);
  assert.deepEqual([edge.markers.quiet[0].start, edge.markers.quiet[0].end], [60, 80]);
  const moved = applyDrag(start, hit(680, waveY), 68, 70);
  assert.deepEqual([moved.markers.quiet[0].start, moved.markers.quiet[0].end], [62, 77]);
  const grid = applyDrag(start, hit(400, 5), 40, 40.1);
  assert.ok(Math.abs(grid.markers.grid.offset - 0.1) < 0.001);
  const drawn = applyDrag(start, hit(900, waveY), 90, 95, { newQuiet: true });
  assert.deepEqual(drawn.markers.quiet.map(({ start: from, end }) => [from, end]), [[60, 75], [90, 95]]);
  assert.equal(applyDrag(start, hit(900, waveY), 90, 95).markers, markers, 'a plain drag on the waveform changes nothing');
});

test('A new cue takes over the preset of the section it splits', () => {
  const fixed = createVisconf({ song: { title: 'Song' }, cues: [{ time: 10, preset: { mode: 'fixed', name: 'A' }, transition: 'soft' }] });
  const split = insertCue(fixed, 20.2, { markers, snap: true });
  assert.deepEqual(split.cues.map(({ time, preset, transition, origin }) => [time, preset.name, transition, origin]), [
    [10, 'A', 'soft', 'manual'],
    [20, 'A', 'soft', 'manual'],
  ]);
  assert.equal(insertCue(fixed, 5).cues[0].preset.mode, 'random', 'before the first cue: random');
});

test('Song and artist come from the file name', () => {
  assert.deepEqual(songFromFileName('Daft Punk - One More Time.mp3'), { artist: 'Daft Punk', title: 'One More Time' });
  assert.deepEqual(songFromFileName('Drunk Wishing-PxXexMXrbLs.mp3'), { artist: '', title: 'Drunk Wishing' });
  assert.deepEqual(songFromFileName('Artist - Title - Remix.flac'), { artist: 'Artist', title: 'Title - Remix' });
  assert.equal(formatTime(75.25), '1:15.3');
});

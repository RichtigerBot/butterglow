import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalyserSpectrum } from '../src/audio/analyser-spectrum.js';
import { createCuePlayer, createSongClock, resolvePreset } from '../src/visconf/cue-player.js';
import { analyzeSong, createSongRecorder, waveformPeaks } from '../src/visconf/song-analysis.js';
import {
  addCue,
  createVisconf,
  cueAt,
  cuesFromMarkers,
  followMarkers,
  fromFile,
  normalizeTitle,
  removeCue,
  sameSong,
  snapToBeat,
  toFile,
  updateCue,
  exportFileName,
} from '../src/visconf/visconf-model.js';
import {
  addDrop,
  addQuiet,
  beatsOf,
  createTapTempo,
  gridFromBeats,
  markersFromAnalysis,
  moveDrop,
  normalizeMarkers,
  refreshMarkers,
  removeDrop,
  removeQuiet,
  setDownbeat,
  setTempo,
  shiftGrid,
  updateQuiet,
} from '../src/visconf/song-markers.js';
import { createVisconfStore } from '../src/visconf/visconf-store.js';

const SONG = { title: 'Test Song (Official Video)', artist: 'Test Band', duration: 120 };

// A synthetic song at 120 BPM: a pad throughout, kicks for 10 s, a breakdown without bass, the drop at 20 s.
function syntheticSong(sampleRate = 48000) {
  const seconds = 40;
  const samples = Float32Array.from({ length: seconds * sampleRate }, (_, i) => Math.sin((2 * Math.PI * 330 * i) / sampleRate) * 0.1);
  for (let beat = 0; beat < seconds * 2; beat++) {
    if (beat >= 20 && beat < 40) continue;
    const start = Math.round(beat * 0.5 * sampleRate);
    for (let i = 0; i < 0.25 * sampleRate; i++) {
      const time = i / sampleRate;
      samples[start + i] += Math.sin(2 * Math.PI * 55 * time) * 0.9 * Math.exp(-time / 0.12);
    }
  }
  return { samples, sampleRate };
}

test('The spectrum of a sine has its peak in the right bin', () => {
  const sampleRate = 48000;
  const samples = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * 1500 * i) / sampleRate) * 0.5);
  const spectrum = createAnalyserSpectrum()(samples, 4096, new Uint8Array(1024));
  const peak = spectrum.indexOf(Math.max(...spectrum));
  assert.equal(peak, Math.round(1500 / (sampleRate / 2048)));
});

test('The waveform has one column per 1/20 s with the peak level', () => {
  const samples = new Float32Array(48000);
  samples[100] = 0.5;
  samples[30000] = -1;
  const peaks = waveformPeaks(samples, 48000);
  assert.equal(peaks.length, 20);
  assert.equal(peaks[0], 128);
  assert.equal(peaks[12], 255);
  assert.equal(peaks[5], 0);
});

test('Analysing a song finds the drop, the beats and the tempo', async () => {
  const { samples, sampleRate } = syntheticSong();
  const progress = [];
  const analysis = await analyzeSong(samples, sampleRate, { onProgress: (value) => progress.push(value) });
  assert.equal(analysis.duration, 40);
  assert.equal(analysis.waveform.peaks.length, 800);
  assert.equal(analysis.drops.length, 1, JSON.stringify(analysis.drops));
  assert.ok(Math.abs(analysis.drops[0].time - 20) < 0.2, `drop at ${analysis.drops[0].time}`);
  assert.ok(analysis.beats.filter((time) => time > 20.5).length > 30, 'kicks after the drop');
  assert.equal(analysis.bpm, 120);
  const breakdown = analysis.quietParts.find(({ start }) => start > 10 && start < 13);
  assert.ok(breakdown && breakdown.end > 19 && breakdown.end < 21, `breakdown ${JSON.stringify(analysis.quietParts)}`);
  assert.deepEqual(analysis.quietStarts, analysis.quietParts.map(({ start }) => start));
  assert.equal(progress.at(-1), 1);
});

test('Recording while listening gives the same format', () => {
  const recorder = createSongRecorder();
  for (let frame = 0; frame < 600; frame++) {
    const position = frame / 60;
    recorder.frame(position, { peak: position > 5 ? 0.8 : 0.1, section: position > 5 && position < 8 ? 'quiet' : 'normal', bpm: 128, kick: frame % 30 === 0 });
  }
  recorder.drop(8.02, 0.9);
  recorder.drop(8.04, 0.9); // after a seek the same drop again
  const analysis = recorder.finish(10);
  assert.equal(analysis.source, 'live');
  assert.equal(analysis.waveform.peaks.length, 200);
  assert.deepEqual(analysis.drops, [{ time: 8.04, strength: 0.9 }]);
  assert.equal(analysis.quietStarts.length, 1);
  assert.ok(Math.abs(analysis.quietStarts[0] - 5) < 0.1);
  assert.equal(analysis.bpm, 128);
  assert.equal(analysis.beats.length, 20);
});

test('The same song is found again on another site', () => {
  assert.equal(normalizeTitle('Café del Mar  (Official Video) [HD]'), 'cafe del mar');
  assert.ok(sameSong(SONG, { title: 'test song', artist: 'TEST BAND', duration: 122 }));
  assert.ok(sameSong(SONG, { title: 'Test Song', artist: 'Test Band', duration: 0 }), 'unknown length');
  assert.ok(!sameSong(SONG, { title: 'Test Song', artist: 'Test Band', duration: 300 }), 'extended mix');
  assert.ok(!sameSong(SONG, { title: 'Other Song', artist: 'Test Band', duration: 120 }));
});

test('Cues stay sorted and can be added, moved, changed and removed', () => {
  let visconf = createVisconf({ name: 'Set', song: SONG });
  visconf = addCue(visconf, { time: 30, preset: { mode: 'fixed', name: 'A' } });
  visconf = addCue(visconf, { time: 10, transition: 'soft' });
  visconf = addCue(visconf, { time: -5 }); // ignored
  assert.deepEqual(visconf.cues.map((cue) => cue.time), [10, 30]);
  assert.deepEqual(visconf.cues[0].preset, { mode: 'random', pool: 'all' });
  const [first, second] = visconf.cues;
  visconf = updateCue(visconf, first.id, { time: 50 });
  assert.deepEqual(visconf.cues.map((cue) => cue.id), [second.id, first.id]);
  visconf = updateCue(visconf, first.id, { preset: { mode: 'random', pool: 'favorites' }, transition: 'cut' });
  assert.equal(visconf.cues[1].preset.pool, 'favorites');
  assert.equal(cueAt(visconf, 5), null);
  assert.equal(cueAt(visconf, 40).id, second.id);
  visconf = removeCue(visconf, second.id);
  assert.equal(visconf.cues.length, 1);
});

test('Cues after the end of the song are dropped', () => {
  const visconf = createVisconf({ song: SONG, cues: [{ time: 100 }, { time: 200 }] });
  assert.equal(visconf.cues.length, 1);
});

test('Hand-set times snap to a close beat', () => {
  const beats = [1, 1.5, 2, 2.5];
  assert.equal(snapToBeat(1.6, beats), 1.5);
  assert.equal(snapToBeat(2.3, beats), 2.5);
  assert.equal(snapToBeat(4, beats), 4, 'no beat nearby');
  assert.equal(snapToBeat(0.9, []), 0.9);
});

test('A draft from the markers: cut on drops, soft at quiet parts', () => {
  const markers = markersFromAnalysis({ duration: 120, drops: [{ time: 60, strength: 1 }], quietParts: [{ start: 30, end: 40 }] });
  const cues = cuesFromMarkers(markers, { pool: 'favorites' });
  assert.deepEqual(
    cues.map(({ time, transition, origin, preset }) => [time, transition, origin, preset.pool]),
    [
      [30, 'soft', 'quiet', 'favorites'],
      [60, 'cut', 'drop', 'favorites'],
    ],
  );
});

test('Changes follow their drops and quiet parts: moved, deleted and added with them', () => {
  const markers = markersFromAnalysis({ duration: 120, drops: [{ time: 60, strength: 1 }], quietParts: [{ start: 30, end: 40 }] });
  const [quietPart] = markers.quiet;
  const [drop] = markers.drops;
  // An older visconf without links, plus a change set by hand.
  const visconf = createVisconf({
    song: SONG,
    cues: [
      { time: 30, origin: 'quiet', transition: 'soft', preset: { mode: 'fixed', name: 'Calm' } },
      { time: 60, origin: 'drop' },
      { time: 90, origin: 'manual' },
    ],
  });
  const moved = followMarkers(visconf, markers, moveDrop(markers, drop.id, 64));
  assert.deepEqual(moved.cues.map(({ time, marker }) => [time, marker]), [[30, quietPart.id], [64, drop.id], [90, '']]);
  const added = followMarkers(moved, markers, addDrop(markers, 100));
  assert.deepEqual(added.cues.map(({ time, transition, origin }) => [time, transition, origin]), [[30, 'soft', 'quiet'], [60, 'cut', 'drop'], [90, 'cut', 'manual'], [100, 'cut', 'drop']]);
  const removed = followMarkers(visconf, markers, removeQuiet(removeDrop(markers, drop.id), quietPart.id));
  assert.deepEqual(removed.cues.map(({ time }) => time), [90]);
  const shifted = followMarkers(visconf, markers, updateQuiet(markers, quietPart.id, { start: 25, end: 35 }));
  assert.equal(shifted.cues[0].preset.name, 'Calm', 'the cue keeps its preset');
  assert.equal(shifted.cues[0].time, 25);
  assert.equal(followMarkers(visconf, markers, markers), visconf, 'nothing changed');
  assert.ok(cuesFromMarkers(markers).every((cue) => cue.marker), 'a draft links every cue');
});

const ANALYSIS = {
  duration: 120,
  drops: [{ time: 30, strength: 0.8 }, { time: 90, strength: 1 }],
  quietParts: [{ start: 60, end: 75 }],
  beats: [0.25, 0.75, 1.25, 1.75, 2.26, 2.74],
  bpm: 120,
};

test('Markers start from the analysis with a beat grid that fits the kicks', () => {
  const markers = markersFromAnalysis(ANALYSIS);
  assert.deepEqual(markers.drops.map(({ time, manual }) => [time, manual]), [[30, false], [90, false]]);
  assert.deepEqual(markers.quiet.map(({ start, end }) => [start, end]), [[60, 75]]);
  assert.ok(Math.abs(markers.grid.bpm - 120) < 0.3, `bpm ${markers.grid.bpm}`);
  assert.ok(Math.abs(markers.grid.offset - 0.25) < 0.01, `offset ${markers.grid.offset}`);
  assert.deepEqual(beatsOf(markers.grid, 2).map((time) => Math.round(time * 100) / 100), [0.25, 0.75, 1.25, 1.75]);
  const old = markersFromAnalysis({ duration: 60, drops: [{ time: 40 }], quietStarts: [10, 35] });
  assert.deepEqual(old.quiet.map(({ start, end }) => [start, end]), [[10, 18], [35, 40]], 'older analyses with only starts');
});

test('Drops can be added, dragged and deleted by hand', () => {
  let markers = markersFromAnalysis(ANALYSIS);
  const [first] = markers.drops;
  markers = moveDrop(markers, first.id, 100);
  assert.deepEqual(markers.drops.map(({ time, manual }) => [time, manual]), [[90, false], [100, true]]);
  markers = moveDrop(markers, first.id, 500);
  assert.equal(markers.drops[1].time, 120, 'not past the end of the song');
  markers = addDrop(markers, 10);
  assert.equal(markers.drops[0].time, 10);
  assert.ok(markers.drops[0].manual);
  markers = removeDrop(markers, markers.drops.find(({ time }) => time === 90).id);
  assert.deepEqual(markers.hidden, [90], 'deleted automatic drop is remembered');
  assert.equal(markers.drops.length, 2);
});

test('Quiet parts can be added, resized, moved and deleted', () => {
  let markers = markersFromAnalysis(ANALYSIS);
  const [part] = markers.quiet;
  markers = updateQuiet(markers, part.id, { end: 80 });
  assert.deepEqual([markers.quiet[0].start, markers.quiet[0].end, markers.quiet[0].manual], [60, 80, true]);
  markers = updateQuiet(markers, part.id, { start: 85 });
  assert.equal(markers.quiet[0].end, 85.5, 'start past the end pushes the end, the range stays at least 0.5 s');
  markers = updateQuiet(markers, part.id, { start: 50, end: 55 });
  assert.deepEqual([markers.quiet[0].start, markers.quiet[0].end], [50, 55], 'moved as a whole');
  markers = addQuiet(markers, 100, 200);
  assert.deepEqual([markers.quiet[1].start, markers.quiet[1].end], [100, 120]);
  markers = removeQuiet(markers, markers.quiet[1].id);
  assert.deepEqual(markers.hidden, [], 'deleting a hand-made part leaves nothing to hide');
  assert.equal(markers.quiet.length, 1);
});

test('The beat grid can be set by number, moved and placed on a kick', () => {
  let markers = markersFromAnalysis(ANALYSIS);
  markers = setTempo(markers, 128, 2.25);
  assert.equal(markers.grid.bpm, 128);
  assert.ok(beatsOf(markers.grid, 3).some((time) => Math.abs(time - 2.25) < 0.01), 'the beat at the anchor stays');
  assert.ok(markers.grid.manual);
  assert.equal(setTempo(markers, 1000).grid.bpm, 240, 'clamped');
  markers = shiftGrid(markers, 2.25, 2.3);
  assert.ok(beatsOf(markers.grid, 3).some((time) => Math.abs(time - 2.3) < 0.01));
  markers = setDownbeat(markers, 1.0);
  assert.ok(beatsOf(markers.grid, 3).some((time) => Math.abs(time - 1.0) < 0.001));
  assert.equal(gridFromBeats([], null).bpm, null);
  assert.equal(shiftGrid(markersFromAnalysis({ duration: 10 }), 0, 1).grid.offset, 0, 'no grid without tempo');
});

test('Tap tempo finds the tempo after four taps and starts again after a pause', () => {
  const tapper = createTapTempo();
  assert.equal(tapper.tap(10), null);
  tapper.tap(10.5);
  tapper.tap(11.01);
  assert.ok(Math.abs(tapper.tap(11.5) - 120) < 0.5, 'a slightly early or late tap barely matters');
  assert.equal(tapper.last, 11.5);
  assert.equal(tapper.tap(20), null, 'pause: new measurement');
});

test('A new analysis keeps hand-made changes and deleted markers stay deleted', () => {
  let markers = markersFromAnalysis(ANALYSIS);
  markers = removeDrop(markers, markers.drops[0].id); // automatic drop at 30
  markers = moveDrop(markers, markers.drops[0].id, 95); // automatic 90 moved by hand to 95
  markers = setTempo(markers, 126);
  const fresh = refreshMarkers(markers, { ...ANALYSIS, drops: [{ time: 30.2 }, { time: 95.1 }, { time: 110 }], bpm: 124 });
  assert.deepEqual(fresh.drops.map(({ time, manual }) => [time, manual]), [[95, true], [110, false]]);
  assert.equal(fresh.grid.bpm, 126, 'hand-set tempo stays');
  assert.equal(refreshMarkers(markersFromAnalysis(ANALYSIS), { ...ANALYSIS, bpm: 124 }).grid.bpm, 124, 'automatic tempo follows');
});

test('Broken markers from storage or a file are cleaned up', () => {
  assert.equal(normalizeMarkers(null), null);
  assert.equal(normalizeMarkers({ drops: [] }), null);
  const clean = normalizeMarkers({ duration: 60, drops: [{ time: 'x' }, { time: 5 }], quiet: [{ start: 1 }], grid: { bpm: 999 }, hidden: ['a', 3] });
  assert.equal(clean.drops.length, 1);
  assert.equal(clean.quiet.length, 0);
  assert.equal(clean.grid.bpm, null);
  assert.deepEqual(clean.hidden, [3]);
});

test('Export and import keep visconfs and analyses, and reject other files', () => {
  const visconf = createVisconf({ name: 'Set', song: SONG, cues: [{ time: 12, label: 'Drop' }] });
  const analyses = { key: { duration: 120, waveform: { perSecond: 20, peaks: [1, 2] } }, broken: { duration: 'x' } };
  const markers = { key: addDrop(markersFromAnalysis(ANALYSIS), 5), broken: { duration: 'x' } };
  const { visconfs, analyses: restored, markers: restoredMarkers } = fromFile(toFile([visconf, { song: {} }], analyses, markers));
  assert.deepEqual(visconfs, [visconf]);
  assert.deepEqual(Object.keys(restored), ['key']);
  assert.deepEqual(restoredMarkers, { key: markers.key });
  assert.throws(() => fromFile('{'), /not-json/);
  assert.throws(() => fromFile('{"kind":"butterglow-collections"}'), /not-visconfs/);
  assert.throws(() => fromFile('{"kind":"butterglow-visconfs","version":99,"visconfs":[]}'), /too-new/);
});

test('The cue player starts the right section, follows cues and handles seeks', () => {
  const visconf = createVisconf({ song: SONG, cues: [{ time: 10, transition: 'soft' }, { time: 20 }, { time: 21 }] });
  const [a, b, c] = visconf.cues;
  const player = createCuePlayer({ resolvePreset: (cue) => `preset-${cue.time}` });
  player.load(visconf);
  assert.equal(player.update(5), null, 'before the first cue');
  assert.equal(player.update(9.98), null);
  assert.deepEqual(player.update(10.01), { cue: a, transition: 'soft', reason: 'cue', preset: 'preset-10' });
  assert.equal(player.update(10.03), null, 'only once');
  assert.deepEqual(player.upcoming(15), { cue: b, inSeconds: 5 });
  assert.equal(player.update(20.5).cue.id, b.id);
  assert.equal(player.update(21.6).cue.id, c.id, 'two cues close together');
  const seekBack = player.update(12);
  assert.deepEqual([seekBack.cue.id, seekBack.transition, seekBack.reason], [a.id, 'cut', 'seek']);
  assert.equal(player.update(10.5), null, 'seek within the same section');
  player.load(visconf);
  assert.equal(player.update(20.5).reason, 'start');
  assert.equal(player.active.id, b.id);
});

test('The song clock runs between reports and follows seeks', () => {
  const clock = createSongClock();
  clock.sync({ position: 10, playing: true }, 100);
  assert.equal(clock.position(100.5), 10.5);
  clock.sync({ position: 10.95, playing: true }, 101); // a slightly late report does not jump
  assert.ok(Math.abs(clock.position(101) - 10.99) < 0.001);
  clock.sync({ position: 60, playing: true }, 102);
  assert.equal(clock.position(102), 60);
  clock.sync({ position: 61, playing: false }, 103);
  assert.equal(clock.position(110), 61, 'paused');
});

test('Presets: fixed ones, random from a collection, never the same one twice in a row', () => {
  const allNames = ['A', 'B', 'C', 'D'];
  const namesOf = (pool) => (pool === 'favorites' ? ['B', 'C', 'gone'] : allNames);
  const fixed = { preset: { mode: 'fixed', name: 'C' } };
  assert.equal(resolvePreset(fixed, { allNames }), 'C');
  assert.ok(allNames.includes(resolvePreset({ preset: { mode: 'fixed', name: 'deleted' } }, { allNames })), 'deleted preset falls back');
  const favorite = { preset: { mode: 'random', pool: 'favorites' } };
  for (let i = 0; i < 20; i++) assert.equal(resolvePreset(favorite, { allNames, namesOf, current: 'B' }), 'C');
  const empty = { preset: { mode: 'random', pool: 'empty' } };
  assert.ok(allNames.includes(resolvePreset(empty, { allNames, namesOf: () => [] })), 'empty collection uses all');
});

test('The store keeps visconfs per song and merges imports', async () => {
  const data = {};
  const area = { get: async (key) => ({ [key]: structuredClone(data[key]) }), set: async (values) => Object.assign(data, structuredClone(values)) };
  const store = createVisconfStore(area);
  const first = await store.save(createVisconf({ name: 'One', song: SONG }));
  await store.save(createVisconf({ name: 'Other', song: { title: 'Other', artist: 'X' } }));
  await store.save({ ...first, name: 'One renamed' });
  const forSong = await store.forSong({ title: 'test song', artist: 'test band', duration: 121 });
  assert.deepEqual(forSong.map((visconf) => visconf.name), ['One renamed']);
  await store.saveAnalysis(SONG, { duration: 120, waveform: { perSecond: 20, peaks: [] } });
  assert.equal((await store.analysisFor({ title: 'Test Song', artist: 'Test Band' })).duration, 120);
  const added = await store.merge({ visconfs: [{ ...first, name: 'Imported' }], analyses: {} });
  assert.equal(added, 1);
  assert.equal((await store.all()).length, 2);
  assert.equal((await store.forSong(SONG))[0].name, 'Imported');
  await store.remove(first.id);
  assert.equal((await store.all()).length, 1);
});

test('The store keeps hand-made markers across a new analysis and can reset them', async () => {
  const data = {};
  const area = { get: async (key) => ({ [key]: structuredClone(data[key]) }), set: async (values) => Object.assign(data, structuredClone(values)) };
  const store = createVisconfStore(area);
  assert.equal(await store.markersFor(SONG), null);
  await store.saveAnalysis(SONG, ANALYSIS);
  let markers = await store.markersFor(SONG);
  assert.equal(markers.drops.length, 2);
  markers = addDrop(markers, 12);
  await store.saveMarkers(SONG, markers);
  await store.saveAnalysis(SONG, { ...ANALYSIS, drops: [{ time: 30 }] });
  assert.deepEqual((await store.markersFor(SONG)).drops.map(({ time }) => time), [12, 30]);
  assert.deepEqual((await store.resetMarkers(SONG)).drops.map(({ time }) => time), [30]);
  await store.merge({ markers: { [Object.keys(await store.markers())[0]]: addDrop(markersFromAnalysis(ANALYSIS), 1) } });
  assert.equal((await store.markersFor(SONG)).drops[0].time, 1, 'imported markers replace');
});

test('The export file name has artist, title, date and time, and is valid on every system', () => {
  const date = new Date(2026, 10, 5, 9, 7);
  assert.equal(exportFileName({ artist: 'Daft Punk', title: 'One More Time' }, date), 'Daft-Punk_One-More-Time_2026-11-05_09-07.json');
  assert.equal(exportFileName({ artist: 'AC/DC', title: 'What? <Live>: "Part 1" | 2' }, date), 'AC-DC_What-Live-Part-1-2_2026-11-05_09-07.json');
  assert.equal(exportFileName({ artist: '', title: 'only_title' }, date), 'only-title_2026-11-05_09-07.json');
  assert.equal(exportFileName({ artist: ' ', title: '' }, date), 'visconf_2026-11-05_09-07.json');
  assert.equal(exportFileName(null, date), 'visconf_2026-11-05_09-07.json');
  const long = exportFileName({ artist: 'A'.repeat(100), title: 'Ä Ö Ü' }, date);
  assert.equal(long, `${'A'.repeat(60)}_Ä-Ö-Ü_2026-11-05_09-07.json`);
});

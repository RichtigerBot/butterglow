import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalyserSpectrum } from '../src/audio/analyser-spectrum.js';
import { createCuePlayer, createSongClock, resolvePreset } from '../src/visconf/cue-player.js';
import { analyzeSong, createSongRecorder, waveformPeaks } from '../src/visconf/song-analysis.js';
import {
  addCue,
  createVisconf,
  cueAt,
  cuesFromAnalysis,
  fromFile,
  normalizeTitle,
  removeCue,
  sameSong,
  snapToBeat,
  toFile,
  updateCue,
} from '../src/visconf/visconf-model.js';
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
  assert.ok(analysis.quietStarts.some((time) => time > 10 && time < 13), `breakdown at ${analysis.quietStarts}`);
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

test('A draft from the analysis: cut on drops, soft at quiet parts', () => {
  const cues = cuesFromAnalysis({ drops: [{ time: 60, strength: 1 }], quietStarts: [30] }, { pool: 'favorites' });
  assert.deepEqual(
    cues.map(({ time, transition, origin, preset }) => [time, transition, origin, preset.pool]),
    [
      [30, 'soft', 'quiet', 'favorites'],
      [60, 'cut', 'drop', 'favorites'],
    ],
  );
});

test('Export and import keep visconfs and analyses, and reject other files', () => {
  const visconf = createVisconf({ name: 'Set', song: SONG, cues: [{ time: 12, label: 'Drop' }] });
  const analyses = { key: { duration: 120, waveform: { perSecond: 20, peaks: [1, 2] } }, broken: { duration: 'x' } };
  const { visconfs, analyses: restored } = fromFile(toFile([visconf, { song: {} }], analyses));
  assert.deepEqual(visconfs, [visconf]);
  assert.deepEqual(Object.keys(restored), ['key']);
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

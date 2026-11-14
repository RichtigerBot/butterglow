// Tests the beat detector without a browser, with artificial spectra.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeatDetector } from '../src/audio/beat-detector.js';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE;
const BIN_COUNT = FFT_SIZE / 2;

// Seeded, so the tests always run the same.
function createRandom(seed = 1) {
  let state = seed;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

function run({ seconds, fps = 60, audioBlockSeconds = 0, voices = [], noise = 0, base = 0, seed = 1 }) {
  const detector = new BeatDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const random = createRandom(seed);
  const hits = { kick: [], snare: [], hat: [] };
  const spectrum = new Uint8Array(BIN_COUNT);
  let bpm = null;

  for (let frame = 0; frame < seconds * fps; frame++) {
    const time = frame / fps;
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const hz = bin * HZ_PER_BIN;
      let value = base + random() * noise;
      for (const { startHz, endHz, times, level, decay } of voices) {
        if (hz < startHz || hz > endHz) continue;
        const last = times.findLast((hitTime) => hitTime <= time);
        if (last !== undefined) value += level * Math.exp(-(time - last) / decay);
      }
      spectrum[bin] = Math.min(255, value);
    }
    const audioTime = audioBlockSeconds ? Math.floor(time / audioBlockSeconds) * audioBlockSeconds : time;
    const state = detector.update(spectrum, audioTime);
    for (const band of Object.keys(hits)) if (state[band].hit) hits[band].push(time);
    bpm = state.bpm;
  }
  return { hits, bpm };
}

const beatTimes = (bpm, seconds, offsetBeats = 0, everyBeats = 1) => {
  const times = [];
  for (let t = (offsetBeats * 60) / bpm; t < seconds; t += (everyBeats * 60) / bpm) times.push(t);
  return times;
};

// The curve runs in bytes, i.e. in decibels. A real kick decays more slowly than 0.12 s on this scale.
const kick = (times) => ({ startHz: 30, endHz: 120, times, level: 180, decay: 0.3 });
const snare = (times) => ({ startHz: 1000, endHz: 7000, times, level: 150, decay: 0.08 });
const hat = (times) => ({ startHz: 8000, endHz: 16000, times, level: 120, decay: 0.03 });

test('Silence triggers nothing', () => {
  const { hits, bpm } = run({ seconds: 10 });
  assert.deepEqual(hits, { kick: [], snare: [], hat: [] });
  assert.equal(bpm, null);
});

test('Steady noise triggers hardly anything', () => {
  const { hits } = run({ seconds: 20, base: 100, noise: 12 });
  assert.ok(hits.kick.length + hits.snare.length + hits.hat.length <= 2, JSON.stringify(hits));
});

for (const [bpm, fps] of [[90, 60], [100, 60], [120, 60], [128, 60], [140, 60], [128, 30], [128, 20]]) {
  test(`Kick and tempo at ${bpm} BPM and ${fps} frames per second`, () => {
    const seconds = 16;
    const times = beatTimes(bpm, seconds);
    const { hits, bpm: estimated } = run({ seconds, fps, voices: [kick(times)], base: 60, noise: 8 });
    const expected = times.length - Math.ceil((1 * bpm) / 60); // The first second is learning time.
    assert.ok(Math.abs(hits.kick.length - expected) <= 2, `${hits.kick.length} statt ${expected} Treffer`);
    assert.ok(estimated !== null && Math.abs(estimated - bpm) <= 2, `Tempo ${estimated}`);
  });
}

test('Kick, snare and hi-hat are detected separately', () => {
  const seconds = 16;
  const bpm = 120;
  const { hits } = run({
    seconds,
    base: 60,
    noise: 8,
    voices: [kick(beatTimes(bpm, seconds)), snare(beatTimes(bpm, seconds, 1, 2)), hat(beatTimes(bpm, seconds, 0.5))],
  });
  assert.ok(Math.abs(hits.kick.length - 30) <= 3, `Kick ${hits.kick.length}`);
  assert.ok(Math.abs(hits.snare.length - 15) <= 2, `Snare ${hits.snare.length}`);
  assert.ok(Math.abs(hits.hat.length - 30) <= 3, `hi-hat ${hits.hat.length}`);
});

// As in a real song: eighth-note hi-hats whose sound reaches 3 kHz, over a voice in the snare band.
// Previously every rise there counted as the start of a snare, and almost all hi-hats were lost.
test('Hi-hats with content up to 3 kHz count as hi-hat and not as snare', () => {
  const seconds = 16;
  const bpm = 130;
  const eighths = beatTimes(bpm, seconds, 0.5, 1); // on the "and" counts, never together with kick or snare
  const random = createRandom(7);
  const syllables = Array.from({ length: 60 }, () => random() * seconds);
  syllables.sort((a, b) => a - b);
  const { hits } = run({
    seconds,
    voices: [
      kick(beatTimes(bpm, seconds, 0, 2)),
      snare(beatTimes(bpm, seconds, 1, 2)),
      hat(eighths),
      { startHz: 3000, endHz: 5000, times: eighths, level: 135, decay: 0.05 }, // decay of the hi-hat in the snare band
      { startHz: 1500, endHz: 4000, times: syllables, level: 45, decay: 0.15 }, // voice
    ],
    base: 50,
    noise: 6,
  });
  const expectedHats = eighths.filter((time) => time > 1).length;
  const expectedSnares = beatTimes(bpm, seconds, 1, 2).filter((time) => time > 1).length;
  assert.ok(hits.hat.length >= expectedHats * 0.8, `${hits.hat.length} hi-hats instead of ${expectedHats}`);
  assert.ok(hits.snare.length <= expectedSnares * 1.2, `${hits.snare.length} Snares statt ${expectedSnares}`);
});

test('Irregular hits give no reliable tempo', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = createRandom(seed * 7919);
    const times = [];
    for (let t = 0; t < 16; t += 0.15 + random() * 1.1) times.push(t);
    const { bpm } = run({ seconds: 16, voices: [kick(times)], base: 60, noise: 8, seed });
    assert.equal(bpm, null, `Seed ${seed}`);
  }
});

test('A syncopated kick pattern gives the right tempo or none at all', () => {
  const bpm = 110;
  const times = [0, 1.5, 2.5].flatMap((beat) => beatTimes(bpm, 16, beat, 4));
  times.sort((a, b) => a - b);
  const { bpm: estimated } = run({ seconds: 16, voices: [kick(times)], base: 60, noise: 8 });
  assert.ok(estimated === null || Math.abs(estimated - bpm) <= 2, `Tempo ${estimated}`);
});

test('Tempo trotz grob laufender Audiozeit', () => {
  const times = beatTimes(128, 16);
  const { bpm } = run({ seconds: 16, audioBlockSeconds: 0.04, voices: [kick(times)], base: 60, noise: 8 });
  assert.ok(bpm !== null && Math.abs(bpm - 128) <= 2, `Tempo ${bpm}`);
});

test('Tempo without kick, only from snare and hi-hat', () => {
  const bpm = 100;
  const { bpm: estimated } = run({
    seconds: 16,
    base: 60,
    noise: 8,
    voices: [snare(beatTimes(bpm, 16, 1, 2)), hat(beatTimes(bpm, 16, 0, 0.5))],
  });
  assert.ok(estimated !== null && Math.abs(estimated - bpm) <= 2, `Tempo ${estimated}`);
});

test('The tempo disappears when the music stops', () => {
  const times = beatTimes(120, 8);
  const { bpm } = run({ seconds: 14, voices: [kick(times)], base: 60, noise: 8 });
  assert.equal(bpm, null);
});

test('No false hit after a gap', () => {
  const detector = new BeatDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const quiet = new Uint8Array(BIN_COUNT).fill(40);
  const loud = new Uint8Array(BIN_COUNT).fill(220);
  for (let frame = 0; frame < 120; frame++) detector.update(quiet, frame / 60);
  assert.equal(detector.update(loud, 10).kick.hit, false);
});

test('A hit is reported only once when the audio time stands still', () => {
  const detector = new BeatDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const quiet = new Uint8Array(BIN_COUNT).fill(40);
  const loud = new Uint8Array(BIN_COUNT).fill(220);
  for (let frame = 0; frame < 60; frame++) detector.update(quiet, frame / 60);
  assert.equal(detector.update(loud, 1).kick.hit, true);
  assert.equal(detector.update(loud, 1).kick.hit, false);
});

test('A voice with a fundamental above 100 Hz does not count as a kick', () => {
  const syllables = [];
  const random = createRandom(11);
  for (let t = 0.5; t < 16; t += 0.25 + random() * 0.5) syllables.push(t);
  const { hits } = run({
    seconds: 16,
    base: 40,
    noise: 6,
    voices: [
      { startHz: 100, endHz: 250, times: syllables, level: 170, decay: 0.2 },
      { startHz: 60, endHz: 100, times: syllables, level: 90, decay: 0.2 }, // spread downwards
      { startHz: 500, endHz: 3000, times: syllables, level: 130, decay: 0.2 },
    ],
  });
  assert.ok(hits.kick.length <= 1, `${hits.kick.length} falsche Kicks`);
});

test('A kick with a high attack is still detected', () => {
  const bpm = 120;
  const times = beatTimes(bpm, 16);
  const voices = [
    kick(times),
    { startHz: 100, endHz: 250, times, level: 230, decay: 0.015 }, // click that quickly falls into the bass
  ];
  const { hits } = run({ seconds: 16, base: 60, noise: 8, voices });
  assert.ok(Math.abs(hits.kick.length - 30) <= 3, `${hits.kick.length} statt 30 Kicks`);
});

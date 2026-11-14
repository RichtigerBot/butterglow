// Tests the section detection without a browser, with artificial spectra.
// With real songs: node scripts/tools/analyze-sections.mjs file.mp3
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SectionDetector, confirmSecondsFor } from '../src/audio/section-detector.js';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE;
const BIN_COUNT = FFT_SIZE / 2;
const FPS = 60;
const BEAT_SECONDS = 0.5;

// Bytes as from the analyser: 0 = −90 dB, 255 = −10 dB.
// `parts`: [{ seconds, bass, mid, high, kicks }], bass/mid/high as base levels in bytes (0 = silent).
// Kicks briefly raise the bass on every beat. `high` may be a function of the time within the part (build-up).
// `hit`: a single strong hit at the start of the part, this long in seconds. `lead`: a weaker kick
// at the start (this many bytes quieter); the full one only comes on the second beat.
function run(parts, { gapAt = null, confirmSeconds = 0 } = {}) {
  const detector = new SectionDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, confirmSeconds });
  const onsets = [];
  let cancelled = 0;
  const spectrum = new Uint8Array(BIN_COUNT);
  const drops = [];
  const sections = [];
  let start = 0;
  for (const part of parts) {
    for (let frame = 0; frame < part.seconds * FPS; frame++) {
      const local = frame / FPS;
      const time = start + local;
      if (gapAt !== null && time > gapAt && time < gapAt + 1) continue;
      const sinceBeat = local % BEAT_SECONDS;
      let kick = part.kicks ? 40 * Math.exp(-sinceBeat / 0.12) : 0;
      if (part.lead && local < BEAT_SECONDS) kick -= part.lead;
      const hit = part.hit && local < part.hit ? 230 : 0;
      const high = typeof part.high === 'function' ? part.high(local) : part.high;
      for (let bin = 0; bin < BIN_COUNT; bin++) {
        const hz = bin * HZ_PER_BIN;
        let value = 0;
        if (hz < 120) value = Math.max(hit, part.bass ? part.bass + kick : 0);
        else if (hz < 4000) value = part.mid;
        else value = high;
        spectrum[bin] = Math.max(0, Math.min(255, value));
      }
      const state = detector.update(spectrum, time);
      if (state.drop) {
        drops.push(time);
        onsets.push(state.dropTime);
      }
      if (state.cancelled) cancelled++;
      sections.push({ time, section: state.section });
    }
    start += part.seconds;
  }
  const sectionAt = (time) => sections.findLast((entry) => entry.time <= time)?.section;
  return { drops, onsets, cancelled, sectionAt };
}

const full = (seconds) => ({ seconds, bass: 190, mid: 150, high: 120, kicks: true });
const breakdown = (seconds, high = 120) => ({ seconds, bass: 40, mid: 150, high, kicks: false });
const silence = (seconds) => ({ seconds, bass: 0, mid: 0, high: 0, kicks: false });

test('Silence: no drop, quiet', () => {
  const { drops, sectionAt } = run([silence(20)]);
  assert.deepEqual(drops, []);
  assert.equal(sectionAt(19), 'quiet');
});

test('Evenly loud music has no drop', () => {
  const { drops, sectionAt } = run([full(40)]);
  assert.deepEqual(drops, []);
  assert.equal(sectionAt(39), 'normal');
});

test('After a breakdown the drop comes exactly with the first kick', () => {
  const { drops, sectionAt } = run([full(12), breakdown(8), full(15)]);
  assert.equal(drops.length, 1, `Drops: ${drops}`);
  assert.ok(drops[0] >= 20 && drops[0] < 20.1, `drop at ${drops[0]} s`);
  assert.equal(sectionAt(18), 'quiet');
  assert.equal(sectionAt(25), 'drop');
  assert.equal(sectionAt(34), 'drop');
});

test('The drop section ends when the bass is missing again', () => {
  const { drops, sectionAt } = run([full(12), breakdown(8), full(10), breakdown(8)]);
  assert.equal(drops.length, 1);
  assert.equal(sectionAt(37), 'quiet');
});

test('Two drops in one song', () => {
  const { drops } = run([full(12), breakdown(8), full(16), breakdown(8), full(10)]);
  assert.equal(drops.length, 2, `Drops: ${drops}`);
  assert.ok(Math.abs(drops[1] - 44) < 0.1, `second drop at ${drops[1]} s`);
});

test('Rising highs in the breakdown are a build-up', () => {
  const { drops, sectionAt } = run([full(12), breakdown(4), breakdown(6, (t) => 60 + t * 10), full(6)]);
  assert.equal(sectionAt(21), 'build');
  assert.equal(drops.length, 1);
  assert.equal(sectionAt(25), 'drop');
});

test('A song that starts from silence is not a drop', () => {
  const { drops, sectionAt } = run([silence(10), full(15)]);
  assert.deepEqual(drops, []);
  assert.equal(sectionAt(24), 'normal');
});

test('A quiet kick in the intro is not a drop', () => {
  const quietIntro = { seconds: 12, bass: 30, mid: 120, high: 100, kicks: false };
  const softBeat = { seconds: 8, bass: 120, mid: 120, high: 100, kicks: true };
  const { drops } = run([quietIntro, softBeat]);
  assert.deepEqual(drops, []);
});

test('A gap (hidden window) does not trigger a drop', () => {
  const { drops } = run([full(12), breakdown(8), full(6)], { gapAt: 19.5 });
  assert.ok(drops.every((time) => time >= 20.4), `Drops: ${drops}`);
});

test('Quieter source: the drop still comes at the same time', () => {
  // 38 bytes less is about 12 dB quieter, as if the player were at a quarter.
  const quieter = (part) => ({ ...part, bass: Math.max(0, part.bass - 38), mid: part.mid - 38, high: part.high - 38 });
  const { drops } = run([full(12), breakdown(8), full(10)].map(quieter));
  assert.equal(drops.length, 1, `Drops: ${drops}`);
  assert.ok(drops[0] >= 20 && drops[0] < 20.1, `drop at ${drops[0]} s`);
});

test('The onset counts from the first kick, even if only the second is reliably detected', () => {
  const { drops, onsets } = run([full(12), breakdown(8), { ...full(15), lead: 15 }]);
  assert.equal(drops.length, 1, `Drops: ${drops}`);
  assert.ok(drops[0] >= 20.5, `reported at ${drops[0]} s, only with the second kick`);
  assert.ok(onsets[0] >= 19.98 && onsets[0] < 20.05, `onset at ${onsets[0]} s`);
});

test('With lookahead the drop is confirmed and reported with its onset', () => {
  const confirmSeconds = confirmSecondsFor(0.5);
  const { drops, onsets, cancelled } = run([full(12), breakdown(8), full(15)], { confirmSeconds });
  assert.equal(drops.length, 1, `Drops: ${drops}`);
  assert.equal(cancelled, 0);
  assert.ok(Math.abs(drops[0] - 20 - confirmSeconds) < 0.05, `reported at ${drops[0]} s`);
  assert.ok(onsets[0] >= 19.98 && onsets[0] < 20.05, `onset at ${onsets[0]} s`);
});

test('With lookahead a single hit after the breakdown drops out', () => {
  const parts = [full(12), breakdown(8), { ...breakdown(4), hit: 0.12 }, breakdown(4)];
  assert.equal(run(parts).drops.length, 1, 'without lookahead the hit counts as a drop');
  const { drops, cancelled } = run(parts, { confirmSeconds: confirmSecondsFor(0.5) });
  assert.deepEqual(drops, []);
  assert.equal(cancelled, 1);
});

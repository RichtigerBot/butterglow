// Runs audio files through the beat detector without a browser and faster than real time.
// Reproduces what an AnalyserNode returns (Blackman window, decibels, bytes) and needs ffmpeg.
// Usage: node scripts/tools/analyze-song.mjs [--json folder] file.mp3 ...
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BeatDetector } from '../../src/audio/beat-detector.js';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const FPS = Number(process.env.FPS ?? 60);
const MIN_DB = -90;
const MAX_DB = -10;

export function decode(file) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], {
    maxBuffer: 2 ** 31 - 1,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const { buffer, byteOffset, byteLength } = result.stdout;
  return new Float32Array(buffer.slice(byteOffset, byteOffset + byteLength));
}

const window = Float32Array.from({ length: FFT_SIZE }, (_, i) => {
  const x = (2 * Math.PI * i) / FFT_SIZE;
  return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
});

const reversed = Uint16Array.from({ length: FFT_SIZE }, (_, i) => {
  let result = 0;
  for (let bit = 0; bit < Math.log2(FFT_SIZE); bit++) if (i & (1 << bit)) result |= 1 << (Math.log2(FFT_SIZE) - 1 - bit);
  return result;
});
const cosines = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / FFT_SIZE));
const sines = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / FFT_SIZE));
const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);

export function spectrumAt(samples, end, target) {
  const start = end - FFT_SIZE;
  for (let i = 0; i < FFT_SIZE; i++) {
    const index = reversed[i];
    re[index] = (start + i >= 0 ? samples[start + i] : 0) * window[i];
    im[index] = 0;
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const step = FFT_SIZE / size;
    for (let offset = 0; offset < FFT_SIZE; offset += size) {
      for (let k = 0; k < half; k++) {
        const c = cosines[k * step];
        const s = sines[k * step];
        const a = offset + k;
        const b = a + half;
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let bin = 0; bin < target.length; bin++) {
    const magnitude = Math.hypot(re[bin], im[bin]) / FFT_SIZE;
    const decibels = 20 * Math.log10(magnitude || 1e-12);
    target[bin] = Math.max(0, Math.min(255, (255 * (decibels - MIN_DB)) / (MAX_DB - MIN_DB)));
  }
}

export function analyze(file) {
  const samples = decode(file);
  const detector = new BeatDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const spectrum = new Uint8Array(FFT_SIZE / 2);
  const hits = { kick: [], snare: [], hat: [] };
  const tempo = [];
  const frames = Math.floor((samples.length / SAMPLE_RATE) * FPS);

  for (let frame = 0; frame < frames; frame++) {
    const time = frame / FPS;
    spectrumAt(samples, Math.round(time * SAMPLE_RATE), spectrum);
    const state = detector.update(spectrum, time);
    for (const band of Object.keys(hits)) if (state[band].hit) hits[band].push(Number(time.toFixed(3)));
    if (frame % FPS === 0) tempo.push(state.bpm === null ? null : Number(state.bpm.toFixed(1)));
  }
  return { seconds: samples.length / SAMPLE_RATE, hits, tempo };
}

function summarize(result) {
  const shown = result.tempo.filter((bpm) => bpm !== null);
  const rounded = {};
  for (const bpm of shown) rounded[Math.round(bpm)] = (rounded[Math.round(bpm)] ?? 0) + 1;
  const [mode] = Object.entries(rounded).sort((a, b) => b[1] - a[1])[0] ?? [null];

  // Music usually sits on a grid. Intervals between kicks off the eighth notes are suspicious.
  let onGrid = 0;
  let intervals = 0;
  if (mode) {
    const eighth = 30 / Number(mode);
    for (let i = 1; i < result.hits.kick.length; i++) {
      const interval = result.hits.kick[i] - result.hits.kick[i - 1];
      if (interval > 2) continue;
      intervals++;
      if (Math.abs(interval - Math.round(interval / eighth) * eighth) < 0.03) onGrid++;
    }
  }
  const perMinute = (count) => Math.round((count / result.seconds) * 60);
  return {
    seconds: Math.round(result.seconds),
    bpm: mode,
    bpmShown: `${Math.round((shown.length / result.tempo.length) * 100)}%`,
    kicksPerMin: perMinute(result.hits.kick.length),
    snaresPerMin: perMinute(result.hits.snare.length),
    hatsPerMin: perMinute(result.hits.hat.length),
    kicksOnGrid: intervals ? `${Math.round((onGrid / intervals) * 100)}%` : '-',
  };
}

if (process.argv[1].endsWith('analyze-song.mjs')) {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf('--json');
  const jsonDir = jsonIndex >= 0 ? args.splice(jsonIndex, 2)[1] : null;
  if (jsonDir) mkdirSync(jsonDir, { recursive: true });
  for (const file of args) {
    const result = analyze(file);
    console.log(basename(file).slice(0, 34).padEnd(35), JSON.stringify(summarize(result)));
    if (jsonDir) writeFileSync(join(jsonDir, `${basename(file)}.json`), JSON.stringify(result));
  }
}

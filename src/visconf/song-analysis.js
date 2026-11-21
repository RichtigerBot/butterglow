// Analyses a whole song for a visconf: waveform overview, drops, starts of quiet parts, beats and tempo.
// Two ways lead to the same result:
// - `analyzeSong()` with the samples of a loaded file. Runs the live detectors faster than real time over the
//   whole song, so the drops are the same ones the visualizer would detect while playing.
// - `createSongRecorder()` while the song plays once in a tab. The visualizer passes what it detects live,
//   already converted to the position in the song.

import { createAnalyserSpectrum } from '../audio/analyser-spectrum.js';
import { BeatDetector } from '../audio/beat-detector.js';
import { SectionDetector } from '../audio/section-detector.js';

export const ANALYSIS_VERSION = 1;
export const ANALYSIS_FPS = 60; // like a typical display; the detectors are tuned for it
export const WAVEFORM_PER_SECOND = 20; // columns of the waveform per second of the song
const FFT_SIZE = 2048;
const YIELD_FRAMES = 600; // give the page room to breathe every 10 s of song
const QUIET_MIN_SECONDS = 2; // shorter quiet parts are not worth a soft change
const ROUND = (value) => Math.round(value * 1000) / 1000;

// Highest peak per column, 0 to 255. A column covers 1 / WAVEFORM_PER_SECOND seconds.
export function waveformPeaks(samples, sampleRate, perSecond = WAVEFORM_PER_SECOND) {
  const columns = Math.ceil((samples.length / sampleRate) * perSecond);
  const peaks = new Array(columns).fill(0);
  const size = sampleRate / perSecond;
  for (let column = 0; column < columns; column++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.round((column + 1) * size));
    for (let i = Math.round(column * size); i < end; i++) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks[column] = Math.min(255, Math.round(peak * 255));
  }
  return peaks;
}

// Tempo shown most often while the song plays, rounded to 0.5 BPM. null if the detector never found one.
function mostCommonBpm(values) {
  const counts = new Map();
  for (const bpm of values) if (bpm !== null) counts.set(Math.round(bpm * 2) / 2, (counts.get(Math.round(bpm * 2) / 2) ?? 0) + 1);
  let best = null;
  for (const [bpm, count] of counts) if (best === null || count > counts.get(best)) best = bpm;
  return best;
}

// Quiet parts that last at least QUIET_MIN_SECONDS and do not start the song.
function quietStartsOf(timeline) {
  const starts = [];
  let start = null;
  timeline.forEach(({ time, section }, index) => {
    if (section === 'quiet') {
      if (start === null && index > 0) start = time;
      return;
    }
    if (start !== null && time - start >= QUIET_MIN_SECONDS) starts.push(start);
    start = null;
  });
  return starts;
}

// `samples`: mono, -1 to 1. `onProgress(fraction)` is called now and then; `signal` (AbortSignal) cancels.
export async function analyzeSong(samples, sampleRate, { onProgress, signal, fps = ANALYSIS_FPS } = {}) {
  const spectrumAt = createAnalyserSpectrum({ fftSize: FFT_SIZE });
  const spectrum = new Uint8Array(FFT_SIZE / 2);
  const sections = new SectionDetector({ sampleRate, fftSize: FFT_SIZE });
  const beats = new BeatDetector({ sampleRate, fftSize: FFT_SIZE });
  const duration = samples.length / sampleRate;
  const frames = Math.floor(duration * fps);
  const drops = [];
  const kicks = [];
  const tempo = [];
  const timeline = [];

  for (let frame = 0; frame < frames; frame++) {
    if (frame % YIELD_FRAMES === 0 && frame > 0) {
      signal?.throwIfAborted();
      onProgress?.(frame / frames);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const time = frame / fps;
    spectrumAt(samples, Math.round(time * sampleRate), spectrum);
    const section = sections.update(spectrum, time);
    if (section.drop) drops.push({ time: ROUND(section.dropTime), strength: ROUND(section.dropStrength) });
    const beat = beats.update(spectrum, time);
    if (beat.kick.hit) kicks.push(ROUND(time));
    if (frame % fps === 0) tempo.push(beat.bpm);
    if (frame % Math.round(fps / 10) === 0) timeline.push({ time, section: section.section });
  }
  onProgress?.(1);
  return {
    version: ANALYSIS_VERSION,
    source: 'file',
    duration: ROUND(duration),
    waveform: { perSecond: WAVEFORM_PER_SECOND, peaks: waveformPeaks(samples, sampleRate) },
    drops,
    quietStarts: quietStartsOf(timeline).map(ROUND),
    beats: kicks,
    bpm: mostCommonBpm(tempo),
  };
}

// Collects the same result while the song plays once. All times are positions in the song in seconds.
// A seek during recording is fine: later values for the same spot replace the earlier ones.
export function createSongRecorder() {
  const peaks = [];
  const drops = new Map(); // rounded to 0.1 s, so the same drop is not counted twice after a seek
  const kicks = new Set();
  const tempo = [];
  const timeline = [];

  return {
    // Per frame: peak of the input (0 to 1), section name and tempo of the live detectors, kick hit.
    frame(position, { peak = 0, section = null, bpm = null, kick = false } = {}) {
      if (!(position >= 0)) return;
      const column = Math.floor(position * WAVEFORM_PER_SECOND);
      peaks[column] = Math.max(peaks[column] ?? 0, Math.min(255, Math.round(peak * 255)));
      if (section) timeline.push({ time: position, section });
      if (bpm !== null) tempo.push(bpm);
      if (kick) kicks.add(ROUND(position));
    },
    drop(position, strength = 1) {
      if (position >= 0) drops.set(Math.round(position * 10), { time: ROUND(position), strength: ROUND(strength) });
    },
    finish(duration) {
      const length = Math.ceil(duration * WAVEFORM_PER_SECOND);
      const sorted = timeline.sort((a, b) => a.time - b.time);
      return {
        version: ANALYSIS_VERSION,
        source: 'live',
        duration: ROUND(duration),
        waveform: { perSecond: WAVEFORM_PER_SECOND, peaks: Array.from({ length }, (_, i) => peaks[i] ?? 0) },
        drops: [...drops.values()].filter(({ time }) => time <= duration).sort((a, b) => a.time - b.time),
        quietStarts: quietStartsOf(sorted).map(ROUND),
        beats: [...kicks].filter((time) => time <= duration).sort((a, b) => a - b),
        bpm: mostCommonBpm(tempo),
      };
    },
  };
}

// Browser only: decodes a song file (anything Chrome can play) into mono samples.
export async function decodeSong(arrayBuffer, sampleRate = 48000) {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const buffer = await context.decodeAudioData(arrayBuffer);
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples, sampleRate: buffer.sampleRate };
}

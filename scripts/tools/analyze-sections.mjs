// Runs audio files through the section detection without a browser and shows drops and sections.
// Usage: node scripts/tools/analyze-sections.mjs file.mp3 ...
// Timeline: one column per second, . quiet, / build-up, # drop, - normal.
import { basename } from 'node:path';
import { decode, spectrumAt } from './analyze-song.mjs';
import { SectionDetector } from '../../src/audio/section-detector.js';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const FPS = Number(process.env.FPS ?? 60);
const SYMBOLS = { quiet: '.', build: '/', drop: '#', normal: '-' };

export function analyzeSections(file) {
  const samples = decode(file);
  const detector = new SectionDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const spectrum = new Uint8Array(FFT_SIZE / 2);
  const drops = [];
  const timeline = [];
  for (let frame = 0; frame < Math.floor((samples.length / SAMPLE_RATE) * FPS); frame++) {
    const time = frame / FPS;
    spectrumAt(samples, Math.round(time * SAMPLE_RATE), spectrum);
    const state = detector.update(spectrum, time);
    if (state.drop) drops.push(Number(state.dropTime.toFixed(1)));
    if (frame % FPS === FPS - 1) timeline.push(state.section);
  }
  return { drops, timeline };
}

if (process.argv[1].endsWith('analyze-sections.mjs')) {
  for (const file of process.argv.slice(2)) {
    const { drops, timeline } = analyzeSections(file);
    console.log(`${basename(file).slice(0, 50)}\n  Drops: ${drops.join(', ') || '–'}`);
    const line = timeline.map((section) => SYMBOLS[section]).join('');
    for (let start = 0; start < line.length; start += 60) console.log(`  ${String(start).padStart(3)} ${line.slice(start, start + 60)}`);
  }
}

// Reproduces what an AnalyserNode without smoothing returns (Blackman window, decibels, bytes), from raw samples.
// So a whole song can be analysed faster than real time, with the same detectors as live playback:
// in the browser for a loaded song file, in Node for the tuning tools in scripts/tools/.

import { BEAT_ANALYSER_DECIBELS } from './beat-detector.js';

export function createAnalyserSpectrum({ fftSize = 2048, minDb = BEAT_ANALYSER_DECIBELS.min, maxDb = BEAT_ANALYSER_DECIBELS.max } = {}) {
  const bits = Math.log2(fftSize);
  const window = Float32Array.from({ length: fftSize }, (_, i) => {
    const x = (2 * Math.PI * i) / fftSize;
    return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  });
  const reversed = Uint16Array.from({ length: fftSize }, (_, i) => {
    let result = 0;
    for (let bit = 0; bit < bits; bit++) if (i & (1 << bit)) result |= 1 << (bits - 1 - bit);
    return result;
  });
  const cosines = Float64Array.from({ length: fftSize / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / fftSize));
  const sines = Float64Array.from({ length: fftSize / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / fftSize));
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  // Writes the byte spectrum of the `fftSize` samples that end at `end` into `target` (fftSize / 2 values).
  // Samples before the start count as silence.
  return function spectrumAt(samples, end, target) {
    const start = end - fftSize;
    for (let i = 0; i < fftSize; i++) {
      const index = reversed[i];
      const at = start + i;
      re[index] = (at >= 0 && at < samples.length ? samples[at] : 0) * window[i];
      im[index] = 0;
    }
    for (let size = 2; size <= fftSize; size *= 2) {
      const half = size / 2;
      const step = fftSize / size;
      for (let offset = 0; offset < fftSize; offset += size) {
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
      const magnitude = Math.hypot(re[bin], im[bin]) / fftSize;
      const decibels = 20 * Math.log10(magnitude || 1e-12);
      target[bin] = Math.max(0, Math.min(255, (255 * (decibels - minDb)) / (maxDb - minDb)));
    }
    return target;
  };
}

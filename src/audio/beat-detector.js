// Detects kick, snare and highs separately and estimates the tempo from them.
// Each band looks at the rise in energy compared with the last frames. A hit is a rise
// clearly above what has been usual in that band over the last few seconds.
// This way the detection adapts to volume and music style by itself.

// Share of the last peak by which a hit must at least rise in its band.
const KICK_MIN_RISE = 0.45;
const SNARE_MIN_RISE = 0.5;

const BANDS = {
  kick: { startHz: 30, endHz: 90, refractorySeconds: 0.1, decaySeconds: 0.18, linear: true, minRise: KICK_MIN_RISE },
  snare: { startHz: 1500, endHz: 5000, refractorySeconds: 0.1, decaySeconds: 0.15, linear: true, minRise: SNARE_MIN_RISE },
  hat: { startHz: 8000, endHz: 16000, refractorySeconds: 0.05, decaySeconds: 0.07 },
  tempoBass: { startHz: 30, endHz: 120, refractorySeconds: 0.1, decaySeconds: 0.18 },
  tempoMid: { startHz: 1500, endHz: 5000, refractorySeconds: 0.1, decaySeconds: 0.15 },
  lowMid: { startHz: 110, endHz: 250, refractorySeconds: 0.05, decaySeconds: 0.1, linear: true, minRise: 1 },
};

const ANALYSER_MIN_DB = -90;
const ANALYSER_MAX_DB = -10;
export const BEAT_ANALYSER_DECIBELS = { min: ANALYSER_MIN_DB, max: ANALYSER_MAX_DB };

const LINEAR_RISE_SECONDS = 0.11;
const LINEAR_PEAK_DECAY_SECONDS = 8;
const LINEAR_MIN_AMPLITUDE = 0.0003;
// A kick has its energy in the low end. If the range above clearly dominates, it is more likely the fundamental of a voice.
const KICK_MIN_LOW_RATIO = 0.3;

const HISTORY_FRAMES = 90;
const MIN_HISTORY_FRAMES = 20;
const THRESHOLD_DEVIATIONS = 2;
const MIN_FLUX = 8; // Rise of the band energy on the 0–255 scale; anything below does not count.
const LEAK_WINDOW_SECONDS = 0.08;
// Hi-hat or snare? Both rise in the high band. With a hi-hat the 1.5–5 kHz band (in decibels) rises clearly
// less than the high band, with a snare at least as much. Measured on real songs:
// hi-hats 0.35 to 0.83, snares 0.95 to 1.2.
const HAT_MAX_MID_RATIO = 0.85;
// The decay of a hi-hat reaches 3–5 kHz and makes the snare band rise shortly after. That is not a snare.
// A real snare right after a hi-hat, on the other hand, multiplies its band (measured 7 to 30 times,
// decay 3 to 5 times).
const SNARE_AFTER_HAT_SECONDS = 0.05;
const SNARE_AFTER_HAT_MIN_RISE = 6;
const MAX_GAP_SECONDS = 0.5; // Larger gaps happen when the window was hidden.

const TEMPO_SLOT_SECONDS = 0.02;
const TEMPO_WINDOW_SLOTS = 500;
const TEMPO_MIN_SLOTS = 200;
const TEMPO_UPDATE_SECONDS = 0.5;
const TEMPO_STEP_BPM = 0.25;
const TEMPO_MIN_CONFIDENCE = 0.2;
const TEMPO_HOLD_ESTIMATES = 12; // How long the last tempo stays when a passage is unclear.
const TEMPO_SILENCE_SLOTS = 150;
const TEMPO_SILENCE_RATIO = 0.2;
const TEMPO_BEATS = 4; // How many beats apart the rhythm is compared.
const KICK_TEMPO_WEIGHT = 2;
// Half and double tempo cannot be told apart, so the search stays within one octave.
const MIN_BPM = 80;
const MAX_BPM = 160;

// Converts an analyser byte value back into a linear amplitude.
const LINEAR_AMPLITUDE = Float32Array.from({ length: 256 }, (_, byte) => {
  const decibels = ANALYSER_MIN_DB + (byte / 255) * (ANALYSER_MAX_DB - ANALYSER_MIN_DB);
  return 10 ** (decibels / 20);
});

class BandDetector {
  constructor({ startHz, endHz, refractorySeconds, decaySeconds, linear = false, minRise = 0 }, hzPerBin, binCount) {
    this.linear = linear;
    this.minRise = minRise;
    this.recent = [];
    this.peak = 0;
    this.startBin = Math.max(1, Math.round(startHz / hzPerBin));
    this.endBin = Math.min(binCount, Math.round(endHz / hzPerBin) + 1);
    this.refractorySeconds = refractorySeconds;
    this.decaySeconds = decaySeconds;
    this.previousEnergy = 0;
    this.history = new Float32Array(HISTORY_FRAMES);
    this.reset();
    this.lastHitTime = -Infinity;
    this.lastHitStrength = 0;
    this.hit = false;
    this.strength = 0;
    this.level = 0; // How strong the last hit was compared with the recent peaks (0 to 1).
    this.pulse = 0;
  }

  reset() {
    this.historyCount = 0;
    this.historyIndex = 0;
    this.hasPrevious = false;
  }

  // Deliberately the rise of the whole band energy and not of each single frequency:
  // with noise such as a decaying snare, single frequencies jump all the time, but their sum does not.
  // Kick and snare are measured linearly: on the decibel scale even a tiny change in a quiet band would
  // look large, for example crosstalk from a voice. Their rise is also spread over
  // several frames, so it counts against the lowest value of the last few milliseconds.
  #linearFlux(spectrum, time, deltaSeconds) {
    let sum = 0;
    for (let bin = this.startBin; bin < this.endBin; bin++) sum += LINEAR_AMPLITUDE[spectrum[bin]];
    const energy = sum / (this.endBin - this.startBin);

    // The last frame always stays as a reference, even if at a low frame rate it is older than the time window.
    while (this.recent.length > 1 && time - this.recent[0].time > LINEAR_RISE_SECONDS) this.recent.shift();
    let lowest = energy;
    for (const entry of this.recent) lowest = Math.min(lowest, entry.energy);
    this.recent.push({ time, energy });

    this.peak = Math.max(energy, this.peak * Math.exp(-deltaSeconds / LINEAR_PEAK_DECAY_SECONDS));
    this.energyBefore = lowest;
    this.energy = energy;
    return energy - lowest;
  }

  #flux(spectrum) {
    let sum = 0;
    for (let bin = this.startBin; bin < this.endBin; bin++) sum += spectrum[bin];
    const energy = sum / (this.endBin - this.startBin);
    const flux = Math.max(0, energy - this.previousEnergy);
    this.energyBefore = this.previousEnergy;
    this.previousEnergy = energy;
    this.energy = energy;
    return flux;
  }

  #threshold() {
    let mean = 0;
    for (let i = 0; i < this.historyCount; i++) mean += this.history[i];
    mean /= this.historyCount;
    let variance = 0;
    for (let i = 0; i < this.historyCount; i++) variance += (this.history[i] - mean) ** 2;
    // Linearly, the threshold relative to the last peak is enough. With even kicks the spread would be so high
    // that it would swallow slightly weaker hits.
    if (this.linear) return Math.max(this.peak * this.minRise, LINEAR_MIN_AMPLITUDE);
    return Math.max(MIN_FLUX, mean + THRESHOLD_DEVIATIONS * Math.sqrt(variance / this.historyCount));
  }

  // Remembers the candidate; BeatDetector makes the final decision.
  measure(spectrum, time, deltaSeconds) {
    const flux = this.linear ? this.#linearFlux(spectrum, time, deltaSeconds) : this.#flux(spectrum);
    this.flux = flux;
    this.hit = false;
    this.strength = 0;

    if (this.hasPrevious && this.historyCount >= MIN_HISTORY_FRAMES && time - this.lastHitTime >= this.refractorySeconds) {
      const threshold = this.#threshold();
      if (flux > threshold) {
        this.hit = true;
        this.strength = flux / threshold;
        this.level = this.linear ? Math.min(1, flux / this.peak) : 1;
      }
    }

    if (this.hasPrevious) {
      this.history[this.historyIndex] = flux;
      this.historyIndex = (this.historyIndex + 1) % HISTORY_FRAMES;
      this.historyCount = Math.min(this.historyCount + 1, HISTORY_FRAMES);
    }
    this.hasPrevious = true;
  }

  // Strength of a hit in this frame or very shortly before, otherwise 0.
  recentStrength(time) {
    if (this.hit) return this.strength;
    return time - this.lastHitTime <= LEAK_WINDOW_SECONDS ? this.lastHitStrength : 0;
  }

  finish(time, deltaSeconds) {
    this.pulse *= Math.exp(-deltaSeconds / this.decaySeconds);
    if (this.hit) {
      this.lastHitTime = time;
      this.lastHitStrength = this.strength;
      this.pulse = 1;
    }
  }
}

// Looks for the repetition in the rise signal of all bands (autocorrelation) instead of measuring single hits.
// This also works when kicks are missing, syncopated, or when the audio clock advances in coarse blocks.
class TempoEstimator {
  constructor() {
    this.slots = new Float32Array(TEMPO_WINDOW_SLOTS);
    this.ordered = new Float32Array(TEMPO_WINDOW_SLOTS);
    this.maxLag = Math.ceil(((60 / MIN_BPM) * TEMPO_BEATS) / TEMPO_SLOT_SECONDS) + 1;
    this.correlation = new Float32Array(this.maxLag + 1);
    this.lastSlot = null;
    this.filledSlots = 0;
    this.lastEstimateTime = 0;
    this.unsureEstimates = 0;
    this.bpm = null;
    this.confidence = 0;
  }

  add(time, flux) {
    const slot = Math.floor(time / TEMPO_SLOT_SECONDS);
    if (this.lastSlot === null) this.lastSlot = slot;
    for (let next = this.lastSlot + 1; next <= slot; next++) {
      this.slots[next % TEMPO_WINDOW_SLOTS] = 0;
      this.filledSlots = Math.min(this.filledSlots + 1, TEMPO_WINDOW_SLOTS);
    }
    this.lastSlot = slot;
    this.slots[slot % TEMPO_WINDOW_SLOTS] += flux;

    if (this.filledSlots >= TEMPO_MIN_SLOTS && time - this.lastEstimateTime >= TEMPO_UPDATE_SECONDS) {
      this.lastEstimateTime = time;
      this.#estimate();
    }
  }

  // Copies the window in time order and smooths it so that coarse audio blocks do not disturb.
  #prepare() {
    const count = this.filledSlots;
    const first = this.lastSlot - count + 1;
    let mean = 0;
    for (let i = 0; i < count; i++) {
      const before = this.slots[(first + i - 1 + TEMPO_WINDOW_SLOTS) % TEMPO_WINDOW_SLOTS];
      const after = this.slots[(first + i + 1) % TEMPO_WINDOW_SLOTS];
      const value = i > 0 && i < count - 1 ? (before + 2 * this.slots[(first + i) % TEMPO_WINDOW_SLOTS] + after) / 4 : 0;
      this.ordered[i] = value;
      mean += value;
    }
    mean /= count;
    for (let i = 0; i < count; i++) this.ordered[i] -= mean;
    return count;
  }

  // Compares the strongest rises of the last few seconds with the whole window.
  // This way quiet noise after the song also counts as the end.
  #hasRecentSound(count) {
    let recentPeak = 0;
    let windowPeak = 0;
    for (let i = 0; i < count; i++) {
      const value = this.slots[(this.lastSlot - i + TEMPO_WINDOW_SLOTS * 2) % TEMPO_WINDOW_SLOTS];
      windowPeak = Math.max(windowPeak, value);
      if (i < TEMPO_SILENCE_SLOTS) recentPeak = Math.max(recentPeak, value);
    }
    return recentPeak > 0 && recentPeak >= windowPeak * TEMPO_SILENCE_RATIO;
  }

  #correlationAt(lag) {
    const lower = Math.floor(lag);
    const fraction = lag - lower;
    return this.correlation[lower] * (1 - fraction) + this.correlation[lower + 1] * fraction;
  }

  #estimate() {
    const count = this.#prepare();
    const silent = !this.#hasRecentSound(count);

    for (let lag = 0; lag <= this.maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < count - lag; i++) sum += this.ordered[i] * this.ordered[i + lag];
      this.correlation[lag] = sum / (count - lag);
    }
    const peak = this.correlation[0];

    if (silent || peak <= 0) {
      this.bpm = null;
      this.confidence = 0;
      this.unsureEstimates = 0;
      return;
    }

    // A tempo fits if the signal repeats after whole beats. Half beats count less,
    // but they decide between candidates such as 80 and 120 BPM, which share many whole beats.
    let bestScore = 0;
    let bestBpm = MIN_BPM;
    for (let bpm = MIN_BPM; bpm < MAX_BPM; bpm += TEMPO_STEP_BPM) {
      const beatSlots = 60 / bpm / TEMPO_SLOT_SECONDS;
      let score = 0;
      for (let beat = 1; beat <= TEMPO_BEATS; beat++) {
        score += Math.max(0, this.#correlationAt(beat * beatSlots));
        score += 0.5 * Math.max(0, this.#correlationAt((beat - 0.5) * beatSlots));
      }
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    this.confidence = bestScore / (TEMPO_BEATS * 1.5 * peak);
    if (this.confidence >= TEMPO_MIN_CONFIDENCE) {
      this.unsureEstimates = 0;
      if (this.bpm !== null && Math.abs(this.bpm - bestBpm) < 3) this.bpm += (bestBpm - this.bpm) * 0.2;
      else this.bpm = bestBpm;
    } else if (++this.unsureEstimates >= TEMPO_HOLD_ESTIMATES) {
      this.bpm = null;
    }
  }
}

export class BeatDetector {
  constructor({ sampleRate, fftSize }) {
    const hzPerBin = sampleRate / fftSize;
    const binCount = fftSize / 2;
    this.kick = new BandDetector(BANDS.kick, hzPerBin, binCount);
    this.snare = new BandDetector(BANDS.snare, hzPerBin, binCount);
    this.hat = new BandDetector(BANDS.hat, hzPerBin, binCount);
    // The tempo estimate only looks for repetition. It uses the decibel scale, where quieter hits count too,
    // and its bass band may be wider than the one for single kicks.
    this.tempoBass = new BandDetector(BANDS.tempoBass, hzPerBin, binCount);
    this.lowMid = new BandDetector(BANDS.lowMid, hzPerBin, binCount); // Only for comparison, reports no hits.
    this.tempoMid = new BandDetector(BANDS.tempoMid, hzPerBin, binCount);
    this.bands = [this.kick, this.snare, this.hat, this.tempoBass, this.tempoMid, this.lowMid];
    this.tempo = new TempoEstimator();
    this.lastTime = null;
    this.state = { kick: this.kick, snare: this.snare, hat: this.hat, bpm: null };
    this.heldHat = null;
    this.lastHatTime = -Infinity;
  }

  // `spectrum` are byte values of an analyser without smoothing, `time` is the audio time in seconds.
  // For each band the result contains `hit` (hit in this frame), `strength` and `pulse` (1 on a hit, then decays).
  update(spectrum, time) {
    const deltaSeconds = this.lastTime === null ? 0 : time - this.lastTime;
    // The audio time advances in blocks and can stand still across two frames. A hit may only be reported once.
    if (deltaSeconds <= 0 && this.lastTime !== null) {
      for (const band of this.bands) band.hit = false;
      return this.state;
    }
    this.lastTime = time;

    if (deltaSeconds > MAX_GAP_SECONDS) {
      for (const band of this.bands) band.reset();
    }

    for (const band of this.bands) band.measure(spectrum, time, deltaSeconds);

    if (this.kick.hit && this.kick.energy < this.lowMid.energy * KICK_MIN_LOW_RATIO) {
      this.kick.hit = false;
      this.kick.strength = 0;
    }

    // Hi-hat: the high band rises, the snare band clearly less. A snare hit also rises in the high band,
    // but just as much in the mid band. The mid band sometimes reaches its rise only one pass later,
    // so a candidate waits one pass and counts the larger of the two rises.
    // The click of a kick also spreads upwards, but is weaker than a real hi-hat hit.
    let confirmed = null;
    if (this.heldHat) {
      const mid = Math.max(this.heldHat.mid, this.tempoMid.flux);
      if (mid < this.heldHat.flux * HAT_MAX_MID_RATIO) confirmed = this.heldHat.strength;
    }
    const candidate =
      this.hat.hit && this.hat.strength >= this.kick.recentStrength(time) && this.tempoMid.flux < this.hat.flux * HAT_MAX_MID_RATIO
        ? { strength: this.hat.strength, flux: this.hat.flux, mid: this.tempoMid.flux }
        : null;
    this.hat.hit = confirmed !== null;
    this.hat.strength = confirmed ?? 0;
    this.heldHat = this.heldHat === null ? candidate : null;
    if (this.hat.hit) this.lastHatTime = time;

    // If the snare band rises only a little right after a hi-hat, that is its decay and not a snare.
    const snareRise = this.snare.energy / Math.max(this.snare.energyBefore, LINEAR_MIN_AMPLITUDE);
    if (this.snare.hit && time - this.lastHatTime <= SNARE_AFTER_HAT_SECONDS && snareRise < SNARE_AFTER_HAT_MIN_RISE) {
      this.snare.hit = false;
      this.snare.strength = 0;
    }

    for (const band of this.bands) band.finish(time, deltaSeconds);

    this.tempo.add(time, this.tempoBass.flux * KICK_TEMPO_WEIGHT + this.tempoMid.flux + this.hat.flux);
    this.state.bpm = this.tempo.bpm;
    return this.state;
  }
}

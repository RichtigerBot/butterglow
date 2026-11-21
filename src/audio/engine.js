// Audio chain: source → lookahead delay → equalizer → volume → speakers, with the analysis for the visualizers behind it.
// Chrome mutes the captured tab, so everything has to be played back here.
// In "Music" mode the drop detection listens to the sound before the delay, everything else after it. It thus
// knows in advance when a drop becomes audible, and the visualizers react exactly at that moment.

import { BEAT_ANALYSER_DECIBELS, BeatDetector } from './beat-detector.js';
import { SectionDetector, confirmSecondsFor } from './section-detector.js';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_Q = 1.4;
const EQ_RAMP_SECONDS = 0.015;

// Bass boost: the bass below this frequency is split off (Linkwitz-Riley, 24 dB/octave), gently compressed and
// raised. The rest stays unchanged. Together both parts add up to the whole signal again.
export const BASS_BOOST_HZ = 120;
export const BASS_BOOST_MAX_DB = 12;
// Web Audio specifies Q for low- and high-pass filters in dB. Butterworth (linear 0.707) corresponds to -3.01 dB.
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
// Slow enough not to follow single oscillations (at 40 Hz one takes 25 ms). That would distort.
const BASS_COMPRESSOR = { knee: 12, ratio: 6, attack: 0.04, release: 0.3 };
// The threshold is so far below the boost that loud bass is caught here already and not only in the limiter
// (which acts fast and would audibly distort low notes).
const BASS_HEADROOM_DB = 6;

// Chrome's limiter adds some gain by itself (makeup) and lets short peaks through. Keep some distance to 0 dB behind it,
// otherwise peaks above 1.0 come out and are hard-clipped at the output.
const LIMITER_TRIM = 10 ** (-1.5 / 20);

const BASS_MAX_HZ = 250;
const MID_MAX_HZ = 4000;
const BEAT_BANDS = ['kick', 'snare', 'hat'];
const BEAT_INTERVAL_MS = 16;

export const LOOKAHEAD_OPTIONS = [0, 0.5, 1];
const MAX_LOOKAHEAD_SECONDS = 1;
const SWITCH_FADE_SECONDS = 0.03; // Fade out briefly when switching, otherwise the jump in the delay clicks.
const VOLUME_RAMP_SECONDS = 0.03;

export const audioSettings = [
  { id: 'volume', label: 'settings.audio.volume', type: 'range', min: 0, max: 100, default: 100, unit: ' %' },
  {
    id: 'lookahead',
    label: 'settings.audio.mode',
    type: 'select',
    default: 0,
    options: [
      { value: 0, label: 'settings.audio.instant' },
      { value: 0.5, label: 'settings.audio.music05' },
      { value: 1, label: 'settings.audio.music1' },
    ],
  },
];

export class AudioEngine {
  constructor() {
    this.context = new AudioContext();
    this.input = this.context.createGain();
    this.output = this.context.createGain();
    // Lookahead: everything behind this delay (equalizer, sound, picture, beats) runs `lookahead` seconds later.
    this.delay = this.context.createDelay(MAX_LOOKAHEAD_SECONDS + 0.1);
    this.delay.delayTime.value = 0;
    this.lookahead = 0;
    this.input.connect(this.delay);

    this.eqGains = EQ_FREQUENCIES.map(() => 0);
    this.eqEnabled = true;

    this.bands = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = this.context.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = EQ_Q;
      filter.gain.value = 0;
      return filter;
    });
    this.bassBoost = 0; // 0 to 1
    this.bassStage = this.#createBassStage();
    [this.delay, ...this.bands, this.bassStage.input].reduce((from, to) => from.connect(to));
    this.bassStage.output.connect(this.output);
    this.bassMakeupReady = this.#measureBassMakeup().catch((error) => console.warn('Bass boost: measurement failed', error));

    // The limiter catches peaks when bands are raised. Without a boost the signal passes it unchanged.
    // Lowering the overall level in advance would be no solution: then "+" on an empty band like 31 Hz would make everything quieter.
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.dryPath = this.context.createGain();
    this.limitedPath = this.context.createGain();
    this.limitedPath.gain.value = 0;
    this.master = this.context.createGain();
    this.output.connect(this.dryPath).connect(this.master);
    this.output.connect(this.limiter).connect(this.limitedPath).connect(this.master);
    // Own volume: the tab is muted, only what comes out here is audible. No analysis hangs behind it.
    this.volume = this.context.createGain();
    this.fade = this.context.createGain(); // only for switching the lookahead
    this.master.connect(this.volume).connect(this.fade).connect(this.context.destination);

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.output.connect(this.analyser);

    // Beat detection needs unsmoothed data and sits before the equalizer, so sound settings do not distort it.
    // It listens to the delayed sound; in "Music" mode the drop detection listens to the undelayed one (sectionAnalyser).
    this.beatAnalyser = this.context.createAnalyser();
    this.beatAnalyser.fftSize = 2048;
    this.beatAnalyser.smoothingTimeConstant = 0;
    this.beatAnalyser.minDecibels = BEAT_ANALYSER_DECIBELS.min;
    this.beatAnalyser.maxDecibels = BEAT_ANALYSER_DECIBELS.max;
    this.delay.connect(this.beatAnalyser);
    this.beatSpectrum = new Uint8Array(this.beatAnalyser.frequencyBinCount);
    this.sectionAnalyser = this.context.createAnalyser();
    this.sectionAnalyser.fftSize = 2048;
    this.sectionAnalyser.smoothingTimeConstant = 0;
    this.sectionAnalyser.minDecibels = BEAT_ANALYSER_DECIBELS.min;
    this.sectionAnalyser.maxDecibels = BEAT_ANALYSER_DECIBELS.max;
    this.input.connect(this.sectionAnalyser);
    this.sectionSpectrum = new Uint8Array(this.sectionAnalyser.frequencyBinCount);
    this.beats = new BeatDetector({ sampleRate: this.context.sampleRate, fftSize: this.beatAnalyser.fftSize });
    this.sections = new SectionDetector({ sampleRate: this.context.sampleRate, fftSize: this.beatAnalyser.fftSize });
    this.pendingDrop = null;
    this.audibleDropTime = null;
    this.upcomingDrop = null; // { at, confirmed, strength }: when a detected drop becomes audible
    // The sections come from the undelayed sound. For the display they run later by the lookahead.
    this.sectionTimeline = [];
    this.pendingHits = { kick: null, snare: null, hat: null };
    setInterval(() => this.#analyseBeats(), BEAT_INTERVAL_MS);

    this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveform = new Uint8Array(this.analyser.fftSize);
  }

  async captureTab(streamId) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.input);
  }

  // Volume from 0 to 1. Squared, so the slider feels more even.
  setVolume(amount) {
    const level = Math.max(0, Math.min(1, Number(amount) || 0));
    this.volume.gain.setTargetAtTime(level * level, this.context.currentTime, VOLUME_RAMP_SECONDS);
  }

  // Lookahead in seconds: 0 ("Instant" mode), 0.5 or 1. Switching fades out briefly. If the lookahead gets
  // longer, it stays silent for that long, otherwise what was just heard would be heard again.
  setLookahead(seconds) {
    const lookahead = LOOKAHEAD_OPTIONS.includes(seconds) ? seconds : 0;
    if (lookahead === this.lookahead) return;
    const now = this.context.currentTime;
    const switchAt = now + SWITCH_FADE_SECONDS;
    const silence = Math.max(0, lookahead - this.lookahead);
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, switchAt);
    this.delay.delayTime.setValueAtTime(lookahead, switchAt);
    this.fade.gain.setValueAtTime(0, switchAt + silence);
    this.fade.gain.linearRampToValueAtTime(1, switchAt + silence + SWITCH_FADE_SECONDS);
    this.lookahead = lookahead;
    this.sections.confirmSeconds = confirmSecondsFor(lookahead);
    this.upcomingDrop = null;
    this.sectionTimeline.length = 0;
  }

  applySettings({ volume, lookahead }) {
    this.setVolume(volume / 100);
    this.setLookahead(lookahead);
  }

  onStreamEnded(callback) {
    this.stream?.getAudioTracks()[0].addEventListener('ended', callback);
  }

  // Bass boost from 0 (off) to 1 (+12 dB in the bass). Only works while the equalizer is on.
  setBassBoost(amount) {
    this.bassBoost = Math.max(0, Math.min(1, Number(amount) || 0));
    this.#applyEq();
  }

  // Compressor makeup in dB at threshold -(bassDb + headroom), from the measurement at startup (interpolated between whole dB).
  // Until the measurement is done, an estimate is used.
  #bassMakeupTable = null;
  #bassMakeup(bassDb) {
    if (bassDb <= 0) return 0;
    const table = this.#bassMakeupTable;
    if (!table) return bassDb * 0.5 + 2;
    const lower = Math.min(table.length - 2, Math.floor(bassDb));
    const t = bassDb - lower;
    return table[lower] * (1 - t) + table[lower + 1] * t;
  }

  // Measures the makeup without sound: a very quiet sine (far below any threshold) runs offline through an identically
  // configured compressor. How much louder it comes out is the makeup.
  async #measureBassMakeup() {
    const sampleRate = 22050;
    const seconds = 0.4;
    const level = 0.0005;
    const table = [];
    for (let db = 0; db <= BASS_BOOST_MAX_DB; db++) {
      const offline = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
      const osc = offline.createOscillator();
      osc.frequency.value = 60;
      const gain = offline.createGain();
      gain.gain.value = level;
      const compressor = offline.createDynamicsCompressor();
      compressor.threshold.value = -(db + BASS_HEADROOM_DB);
      for (const [key, value] of Object.entries(BASS_COMPRESSOR)) compressor[key].value = value;
      osc.connect(gain).connect(compressor).connect(offline.destination);
      osc.start();
      const data = (await offline.startRendering()).getChannelData(0).subarray(sampleRate * 0.2);
      let power = 0;
      for (const value of data) power += value * value;
      table.push(20 * Math.log10(Math.sqrt(power / data.length) / (level / Math.SQRT2)));
    }
    this.#bassMakeupTable = table;
    this.#applyEq();
  }

  // Without boost the signal passes straight through (dry), otherwise through the crossover (wet).
  // The compressor before the boost sets its threshold below the boost (BASS_HEADROOM_DB): quiet bass is raised
  // fully, loud bass only a little. This keeps the level under control; the limiter behind it hardly has to act.
  #createBassStage() {
    const context = this.context;
    const filter = (type) => Object.assign(context.createBiquadFilter(), { type });
    const input = context.createGain();
    const output = context.createGain();
    const dry = context.createGain();
    const wet = context.createGain();
    wet.gain.value = 0;
    const lows = [filter('lowpass'), filter('lowpass')];
    const highs = [filter('highpass'), filter('highpass')];
    for (const stage of [...lows, ...highs]) {
      stage.frequency.value = BASS_BOOST_HZ;
      stage.Q.value = BUTTERWORTH_Q_DB;
    }
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = 0;
    for (const [key, value] of Object.entries(BASS_COMPRESSOR)) compressor[key].value = value;
    // The compressor delays by a few milliseconds (lookahead). The rest runs through one that does not compress
    // (ratio 1) but delays just as much. Otherwise bass and rest partly cancel out at the crossover frequency.
    const delayMatch = context.createDynamicsCompressor();
    delayMatch.ratio.value = 1;
    delayMatch.threshold.value = 0;
    delayMatch.knee.value = 0;
    const boost = context.createGain();
    input.connect(dry).connect(output);
    input.connect(lows[0]).connect(lows[1]).connect(compressor).connect(boost).connect(wet);
    input.connect(highs[0]).connect(highs[1]).connect(delayMatch).connect(wet);
    wet.connect(output);
    return { input, output, dry, wet, lows, highs, compressor, boost };
  }

  setEqGains(gains) {
    this.eqGains = [...gains];
    this.#applyEq();
  }

  setEqEnabled(enabled) {
    this.eqEnabled = enabled;
    this.#applyEq();
  }

  #applyEq() {
    const now = this.context.currentTime;
    const gains = this.eqEnabled ? this.eqGains : this.eqGains.map(() => 0);
    gains.forEach((decibels, index) => this.bands[index].gain.setTargetAtTime(decibels, now, EQ_RAMP_SECONDS));
    const bassDb = this.eqEnabled ? this.bassBoost * BASS_BOOST_MAX_DB : 0;
    const { dry, wet, compressor, boost } = this.bassStage;
    dry.gain.setTargetAtTime(bassDb > 0 ? 0 : 1, now, EQ_RAMP_SECONDS);
    wet.gain.setTargetAtTime(bassDb > 0 ? 1 : 0, now, EQ_RAMP_SECONDS);
    compressor.threshold.setTargetAtTime(bassDb > 0 ? -(bassDb + BASS_HEADROOM_DB) : 0, now, EQ_RAMP_SECONDS);
    // Chrome's compressor adds gain by itself (makeup). It is subtracted so that quiet bass gets exactly bassDb louder.
    boost.gain.setTargetAtTime(10 ** ((bassDb - this.#bassMakeup(bassDb)) / 20), now, EQ_RAMP_SECONDS);
    const boosted = bassDb > 0 || gains.some((decibels) => decibels > 0);
    this.dryPath.gain.setTargetAtTime(boosted ? 0 : 1, now, EQ_RAMP_SECONDS);
    this.limitedPath.gain.setTargetAtTime(boosted ? LIMITER_TRIM : 0, now, EQ_RAMP_SECONDS);
  }

  // Computes the current overall curve in dB for the display.
  getEqResponse(frequencies, target) {
    const magnitude = new Float32Array(frequencies.length);
    const phase = new Float32Array(frequencies.length);
    target.fill(0);
    for (const band of this.bands) {
      band.getFrequencyResponse(frequencies, magnitude, phase);
      for (let i = 0; i < target.length; i++) target[i] += 20 * Math.log10(magnitude[i]);
    }
    // Bass boost without the compression (that depends on the music): bass part raised plus the rest.
    const bassDb = this.eqEnabled ? this.bassBoost * BASS_BOOST_MAX_DB : 0;
    if (bassDb > 0) {
      const high = new Float32Array(frequencies.length);
      this.bassStage.lows[0].getFrequencyResponse(frequencies, magnitude, phase);
      this.bassStage.highs[0].getFrequencyResponse(frequencies, high, phase);
      const gain = 10 ** (bassDb / 20);
      for (let i = 0; i < target.length; i++) target[i] += 20 * Math.log10(magnitude[i] ** 2 * gain + high[i] ** 2);
    }
  }

  // Returns the current audio data for each frame; levels are between 0 and 1.
  // Peak of the undelayed input (0 to 1). A silent tab delivers exact zeros here.
  inputPeak() {
    this.inputSamples ??= new Float32Array(this.sectionAnalyser.fftSize);
    this.sectionAnalyser.getFloatTimeDomainData(this.inputSamples);
    let peak = 0;
    for (const sample of this.inputSamples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }

  readFrame() {
    this.analyser.getByteFrequencyData(this.frequency);
    this.analyser.getByteTimeDomainData(this.waveform);

    const hzPerBin = this.context.sampleRate / this.analyser.fftSize;
    const bassEnd = Math.max(1, Math.round(BASS_MAX_HZ / hzPerBin));
    const midEnd = Math.round(MID_MAX_HZ / hzPerBin);

    return {
      frequency: this.frequency,
      waveform: this.waveform,
      bass: this.#level(0, bassEnd),
      mid: this.#level(bassEnd, midEnd),
      treble: this.#level(midEnd, this.frequency.length),
      beat: this.#takeBeat(),
      section: this.#takeSection(),
    };
  }

  // Detection runs at its own pace. This way it loses no hits when the graphics card slows down the picture.
  #analyseBeats() {
    const now = this.context.currentTime;
    this.beatAnalyser.getByteFrequencyData(this.beatSpectrum);
    const state = this.beats.update(this.beatSpectrum, now);
    // Without lookahead both analysers hear the same, so one is enough.
    let spectrum = this.beatSpectrum;
    if (this.lookahead > 0) {
      this.sectionAnalyser.getByteFrequencyData(this.sectionSpectrum);
      spectrum = this.sectionSpectrum;
    }
    const section = this.sections.update(spectrum, now);
    // A detected drop becomes audible once its onset has passed through the delay.
    if (section.pending !== null && !this.upcomingDrop) this.upcomingDrop = { at: section.pending + this.lookahead, confirmed: false, strength: 0 };
    if (section.cancelled) this.upcomingDrop = null;
    if (section.drop) {
      if (this.lookahead > 0) this.upcomingDrop = { at: section.dropTime + this.lookahead, confirmed: true, strength: section.dropStrength };
      else this.#fireDrop(section.dropStrength, section.dropTime);
    }
    this.#fireDueDrop();
    if (this.lookahead > 0) {
      const timeline = this.sectionTimeline;
      timeline.push({ at: now + this.lookahead, name: section.section, intensity: section.intensity, build: section.build });
      while (timeline.length > 1 && timeline[1].at <= now) timeline.shift();
    }
    for (const band of BEAT_BANDS) {
      if (state[band].hit) this.pendingHits[band] = { level: state[band].level, strength: state[band].strength };
    }
  }

  #fireDrop(strength, audibleTime) {
    this.pendingDrop = strength;
    this.audibleDropTime = audibleTime;
  }

  // Also checked when a frame is read, so the drop does not wait for the next measurement (16 ms).
  #fireDueDrop() {
    const upcoming = this.upcomingDrop;
    if (!upcoming?.confirmed || this.context.currentTime < upcoming.at) return;
    this.#fireDrop(upcoming.strength, upcoming.at);
    this.upcomingDrop = null;
  }

  // Returns the state for one frame: all hits since the last frame, each exactly once.
  #takeBeat() {
    const state = this.beats.state;
    const beat = { bpm: state.bpm };
    for (const band of BEAT_BANDS) {
      const pending = this.pendingHits[band];
      beat[band] = {
        hit: pending !== null,
        level: pending ? pending.level : state[band].level,
        strength: pending ? pending.strength : state[band].strength,
        pulse: state[band].pulse,
      };
      this.pendingHits[band] = null;
    }
    return beat;
  }

  // Song section for one frame. `drop` is true in exactly one frame, even if it fell between two measurements.
  // `dropIn`: seconds until an already detected drop becomes audible (only with lookahead), otherwise null.
  // `dropConfirmed` tells whether it is confirmed. An unconfirmed one can still be discarded; `dropIn` is then null again.
  #takeSection() {
    this.#fireDueDrop();
    const now = this.context.currentTime;
    const state = this.sections.state;
    const delayed = this.lookahead > 0 ? this.sectionTimeline[0] : null;
    const upcoming = this.upcomingDrop;
    const section = {
      name: delayed?.name ?? state.section,
      drop: this.pendingDrop !== null,
      dropStrength: this.pendingDrop ?? state.dropStrength,
      sinceDrop: this.audibleDropTime === null || now < this.audibleDropTime ? null : now - this.audibleDropTime,
      intensity: delayed?.intensity ?? state.intensity,
      build: delayed?.build ?? state.build,
      dropIn: upcoming ? Math.max(0, upcoming.at - now) : null,
      dropConfirmed: upcoming?.confirmed ?? false,
    };
    this.pendingDrop = null;
    return section;
  }

  #level(start, end) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += this.frequency[i];
    return sum / ((end - start) * 255);
  }
}

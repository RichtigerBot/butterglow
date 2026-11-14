// Small beat as a test source, so the visualizers can be checked without tab capture (visualizer.html?demo=1).

const LOOKAHEAD_SECONDS = 0.2;

export function startDemoSource(context, destination, { bpm = 120, dense = false, voice = null } = {}) {
  if (voice) startVoice(context, destination);
  if (voice === 'only') return;
  if (dense) return startDenseMix(context, destination, bpm);

  const beatSeconds = 60 / bpm;
  const noise = context.createBuffer(1, context.sampleRate * 0.2, context.sampleRate);
  noise.getChannelData(0).forEach((_, i, data) => (data[i] = Math.random() * 2 - 1));

  const playKick = (time) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(gain).connect(destination);
    osc.start(time);
    osc.stop(time + 0.3);
  };

  const playHat = (time) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time);
  };

  const playSnare = (time) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time);
  };

  const playBass = (time, frequency) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + beatSeconds);
    osc.connect(gain).connect(destination);
    osc.start(time);
    osc.stop(time + beatSeconds);
  };

  // A continuous pad, as real music has too. It must not trigger any hits.
  const pad = context.createBiquadFilter();
  const padGain = context.createGain();
  pad.type = 'lowpass';
  pad.frequency.value = 900;
  padGain.gain.value = 0.04;
  pad.connect(padGain).connect(destination);
  for (const frequency of [110, 164.8, 220.5]) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    osc.connect(pad);
    osc.start();
  }

  const bassLine = [55, 55, 65.4, 49];
  let beat = 0;
  let nextBeatTime = context.currentTime;

  setInterval(() => {
    while (nextBeatTime < context.currentTime + LOOKAHEAD_SECONDS) {
      // Under load the timer fires late. Skip missed hits, otherwise they would all sound at once as one loud hit.
      if (nextBeatTime >= context.currentTime) {
        playKick(nextBeatTime);
        if (beat % 2 === 1) playSnare(nextBeatTime);
        playHat(nextBeatTime + beatSeconds / 2);
        playBass(nextBeatTime, bassLine[beat % bassLine.length]);
      }
      nextBeatTime += beatSeconds;
      beat++;
    }
  }, 50);
}

// Closer to a real song: syncopated kick, continuous bass, melody and noise, heavily compressed at the end.
function startDenseMix(context, destination, bpm) {
  const beatSeconds = 60 / bpm;
  const master = context.createDynamicsCompressor();
  master.threshold.value = -24;
  master.ratio.value = 8;
  master.connect(destination);

  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  noise.getChannelData(0).forEach((_, i, data) => (data[i] = Math.random() * 2 - 1));

  const wash = context.createBufferSource();
  const washFilter = context.createBiquadFilter();
  const washGain = context.createGain();
  wash.buffer = noise;
  wash.loop = true;
  washFilter.type = 'bandpass';
  washFilter.frequency.value = 3000;
  washFilter.Q.value = 0.4;
  washGain.gain.value = 0.05;
  wash.connect(washFilter).connect(washGain).connect(master);
  wash.start();

  const bass = context.createOscillator();
  const bassGain = context.createGain();
  bass.type = 'sawtooth';
  bassGain.gain.value = 0.3;
  bass.connect(bassGain).connect(master);
  bass.start();

  const playHit = (time, { type, frequency, endFrequency, level, seconds, filter }) => {
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    let source;
    if (type === 'noise') {
      source = context.createBufferSource();
      source.buffer = noise;
      source.start(time, Math.random());
    } else {
      source = context.createOscillator();
      source.type = type;
      source.frequency.setValueAtTime(frequency, time);
      if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, time + seconds / 2);
      source.start(time);
    }
    source.stop(time + seconds);
    if (filter) {
      const biquad = context.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.frequency;
      source.connect(biquad).connect(gain).connect(master);
    } else {
      source.connect(gain).connect(master);
    }
  };

  // 16 sixteenths each: kick on 1, 2-and and 3-and, snare on 2 and 4, and hi-hat on the eighths with gaps.
  const kickSteps = new Set([0, 6, 10]);
  const snareSteps = new Set([4, 12]);
  const hatSteps = new Set([0, 2, 4, 6, 8, 10, 14]);
  const bassNotes = [55, 55, 82.4, 73.4];
  const melody = [440, 523, 659, 587, 494, 659, 523, 392];

  const stepSeconds = beatSeconds / 4;
  let step = 0;
  let nextStepTime = context.currentTime;

  setInterval(() => {
    while (nextStepTime < context.currentTime + LOOKAHEAD_SECONDS) {
      // Skip missed steps, see above.
      if (nextStepTime < context.currentTime) {
        nextStepTime += stepSeconds;
        step++;
        continue;
      }
      const inBar = step % 16;
      const time = nextStepTime;
      if (kickSteps.has(inBar)) playHit(time, { type: 'sine', frequency: 130, endFrequency: 45, level: 0.7, seconds: 0.22 });
      if (snareSteps.has(inBar)) playHit(time, { type: 'noise', level: 0.45, seconds: 0.16, filter: { type: 'bandpass', frequency: 2500 } });
      if (hatSteps.has(inBar)) playHit(time, { type: 'noise', level: 0.12, seconds: 0.05, filter: { type: 'highpass', frequency: 8000 } });
      if (inBar % 4 === 0) bass.frequency.setValueAtTime(bassNotes[Math.floor(step / 16) % bassNotes.length], time);
      if (step % 3 === 0) {
        playHit(time, { type: 'square', frequency: melody[Math.floor(step / 3) % melody.length], level: 0.1, seconds: stepSeconds * 2.5 });
      }
      nextStepTime += stepSeconds;
      step++;
    }
  }, 50);
}

// Artificial singing voice: fundamental in the range of low male voices, formants and irregular syllables.
function startVoice(context, destination) {
  const voice = context.createOscillator();
  const vibrato = context.createOscillator();
  const vibratoDepth = context.createGain();
  const envelope = context.createGain();
  voice.type = 'sawtooth';
  vibrato.frequency.value = 5.5;
  vibratoDepth.gain.value = 3;
  vibrato.connect(vibratoDepth).connect(voice.frequency);
  envelope.gain.value = 0;

  // The fundamental also stays directly audible, otherwise it would lack energy in the low range.
  const fundamental = context.createBiquadFilter();
  fundamental.type = 'lowpass';
  fundamental.frequency.value = 300;
  voice.connect(fundamental).connect(envelope);
  for (const frequency of [700, 1200, 2600]) {
    const formant = context.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = frequency;
    formant.Q.value = 6;
    voice.connect(formant).connect(envelope);
  }
  envelope.connect(destination);
  voice.start();
  vibrato.start();

  const notes = [98, 110, 123.5, 130.8, 146.8, 110, 164.8];
  let nextTime = context.currentTime;
  setInterval(() => {
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const length = 0.15 + Math.random() * 0.35;
      voice.frequency.setValueAtTime(notes[Math.floor(Math.random() * notes.length)], nextTime);
      envelope.gain.setValueAtTime(0, nextTime);
      envelope.gain.linearRampToValueAtTime(0.5, nextTime + 0.03);
      envelope.gain.setValueAtTime(0.5, nextTime + length * 0.7);
      envelope.gain.linearRampToValueAtTime(0, nextTime + length);
      nextTime += length + Math.random() * 0.25;
    }
  }, 50);
}

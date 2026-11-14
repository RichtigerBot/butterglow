// Computes the water surface, independent of how it is drawn.
// Kicks start real waves (wave equation): they run outwards and come back from the edges.
// Snare and hi-hat make the surface vibrate. Low notes give wide patterns, high ones fine patterns,
// just as the spectrum runs from low to high from left to right.

const DROP_KICK = 2.5; // On a drop, this much higher than a full kick.
const SWELL_POINTS = 128;
const WAVE_SPEED = 0.55; // screen widths per second
const WAVE_DAMPING = 1.6;
const KICK_WIDTH = 0.09;
const KICK_HEIGHT = 2.2; // Splits into two waves, each half as high.
const KICK_RISE_SECONDS = 0.07;
const MAX_SWELL = 1.5; // Soft upper limit, so many kicks do not build up into the visualizer.
const MAX_STEPS_PER_FRAME = 12;

const SNARE_RIPPLES = [
  { cycles: 31, speed: 21, weight: 1 },
  { cycles: 47, speed: -27, weight: 0.8 },
  { cycles: 67, speed: 33, weight: 0.6 },
];
const HAT_RIPPLES = [
  { cycles: 113, speed: 46, weight: 1 },
  { cycles: 157, speed: -58, weight: 0.8 },
  { cycles: 199, speed: 71, weight: 0.6 },
];
const SNARE_DECAY_SECONDS = 0.28;
const HAT_DECAY_SECONDS = 0.12;
const SNARE_AMPLITUDE = 0.16;
const HAT_AMPLITUDE = 0.075;

const IDLE_WAVES = [
  { cycles: 1.3, speed: 0.5, height: 0.05 },
  { cycles: 3.1, speed: -0.8, height: 0.03 },
  { cycles: 7.3, speed: 1.3, height: 0.012 },
];

export class WaterSurface {
  constructor(columns = 512) {
    this.heights = new Float32Array(columns);
    this.swell = new Float32Array(SWELL_POINTS);
    this.velocity = new Float32Array(SWELL_POINTS);
    this.snare = 0;
    this.hat = 0;
    this.time = 0;
    this.stepSeconds = (0.5 * (1 / (SWELL_POINTS - 1))) / WAVE_SPEED;
    this.pendingSeconds = 0;
    this.kicks = [];

    this.kickShape = new Float32Array(SWELL_POINTS);
    let mean = 0;
    for (let i = 0; i < SWELL_POINTS; i++) {
      const distance = (i / (SWELL_POINTS - 1) - 0.5) / KICK_WIDTH;
      this.kickShape[i] = Math.exp(-distance * distance);
      mean += this.kickShape[i] / SWELL_POINTS;
    }
    for (let i = 0; i < SWELL_POINTS; i++) this.kickShape[i] -= mean;
  }

  // Briefly raises the water in the middle. The hill breaks up into two waves that run outwards.
  // At the edge it sinks very slightly to compensate, so the level does not rise with every kick.
  #startKick(amount) {
    this.kicks.push({ remaining: KICK_RISE_SECONDS, amount });
  }

  #applyKicks(dt) {
    for (const kick of this.kicks) {
      const add = (kick.amount * KICK_HEIGHT * dt) / KICK_RISE_SECONDS;
      for (let i = 0; i < SWELL_POINTS; i++) this.swell[i] += add * this.kickShape[i];
      kick.remaining -= dt;
    }
    this.kicks = this.kicks.filter((kick) => kick.remaining > 0);
  }

  #stepSwell() {
    const dt = this.stepSeconds;
    this.#applyKicks(dt);
    const spacing = 1 / (SWELL_POINTS - 1);
    const stiffness = (WAVE_SPEED * WAVE_SPEED) / (spacing * spacing);
    const damping = Math.exp(-WAVE_DAMPING * dt);
    for (let i = 0; i < SWELL_POINTS; i++) {
      // Mirrored at the edges, where the waves are reflected.
      const left = this.swell[i === 0 ? 1 : i - 1];
      const right = this.swell[i === SWELL_POINTS - 1 ? SWELL_POINTS - 2 : i + 1];
      this.velocity[i] = (this.velocity[i] + stiffness * (left + right - 2 * this.swell[i]) * dt) * damping;
    }
    for (let i = 0; i < SWELL_POINTS; i++) this.swell[i] += this.velocity[i] * dt;
  }

  // Time in seconds, `beat` from the beat detector. `waves` and `vibration` are factors from the settings.
  // `drop` is the section from the section detection: on a drop the water rises as with a huge kick.
  update(deltaSeconds, beat, { waves = 1, vibration = 1, drop = null } = {}) {
    this.time += deltaSeconds;
    if (drop?.drop) this.#startKick(DROP_KICK * (0.6 + 0.4 * drop.dropStrength) * waves);
    else if (beat.kick.hit) this.#startKick(beat.kick.level * waves);

    this.pendingSeconds += deltaSeconds;
    let steps = 0;
    while (this.pendingSeconds >= this.stepSeconds && steps < MAX_STEPS_PER_FRAME) {
      this.#stepSwell();
      this.pendingSeconds -= this.stepSeconds;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.pendingSeconds = 0;

    this.snare = beat.snare.hit ? Math.max(this.snare, beat.snare.level) : this.snare * Math.exp(-deltaSeconds / SNARE_DECAY_SECONDS);
    this.hat = beat.hat.hit ? 1 : this.hat * Math.exp(-deltaSeconds / HAT_DECAY_SECONDS);

    this.#compose(vibration);
    return this.heights;
  }

  #compose(vibration) {
    const { heights, swell, time, snare, hat } = this;
    const snareAmount = snare * SNARE_AMPLITUDE * vibration;
    const hatAmount = hat * HAT_AMPLITUDE * vibration;
    const last = heights.length - 1;

    for (let i = 0; i <= last; i++) {
      const x = i / last;
      const position = x * (SWELL_POINTS - 1);
      const lower = Math.min(Math.floor(position), SWELL_POINTS - 2);
      const fraction = position - lower;
      let height = MAX_SWELL * Math.tanh((swell[lower] * (1 - fraction) + swell[lower + 1] * fraction) / MAX_SWELL);

      for (const { cycles, speed, height: size } of IDLE_WAVES) {
        height += size * Math.sin(2 * Math.PI * cycles * x + speed * time);
      }
      if (snareAmount > 0.001) {
        for (const { cycles, speed, weight } of SNARE_RIPPLES) {
          height += snareAmount * weight * Math.sin(2 * Math.PI * cycles * x + speed * time);
        }
      }
      if (hatAmount > 0.001) {
        for (const { cycles, speed, weight } of HAT_RIPPLES) {
          height += hatAmount * weight * Math.sin(2 * Math.PI * cycles * x + speed * time);
        }
      }
      heights[i] = height;
    }
  }
}

// Wave physics for the "Ripples" preset: every hit is a push from above onto deep water.
// The solution is known (Cauchy-Poisson): the waves run outwards as rings, long ones faster than short ones
// (ω² = g·k). This produces by itself what makes real water: one push turns into a train of more and more rings.
// The solution scales with the size of the push. So one table is enough for all hits.

export const GRAVITY = 113; // in world units; a kick ring then takes about 4 s to reach the edge of the picture
// Table dimensions: distance in units of the push size, time in units of sqrt(push size / g).
// `radii` and `times` are the resolution, `wavenumbers` the accuracy of the integral.
export const CIRCLE_TABLE = { radii: 512, times: 256, maxRho: 110, maxTau: 120, wavenumbers: 128, viscosity: 0.008 };
// For "Lively": the rings run twice as far and long, almost to the horizon.
export const LIVELY_TABLE = { radii: 768, times: 384, maxRho: 230, maxTau: 250, wavenumbers: 360, viscosity: 0.004 };
export const TABLE_RADII = CIRCLE_TABLE.radii;
export const TABLE_TIMES = CIRCLE_TABLE.times;
export const MAX_RHO = CIRCLE_TABLE.maxRho;
export const MAX_TAU = CIRCLE_TABLE.maxTau;

const MAX_WAVENUMBER = 4;
const FAR_BOOST_RHO = 6; // Raises distant rings a little, so they stay visible up to the edge of the picture.
const FAR_BOOST_POWER = 0.5;

const MAX_EVENTS = 64;
const SPRAY_RADIUS = 0.35; // Drops do not hit exactly the same point, which gives fine overlaps.
const SATELLITE_DROPS = 2;
const DROP_SIZE = 1.6; // Size of the drop ring, in multiples of sizeByStrength.
const DROP_HEIGHT = 2;
const DROP_RING_SPLASHES = 6;
const DROP_RING_RADIUS = 0.8;

// Push sizes and heights in world units. The wavelength is about 2π · size.
export const CIRCLE_SPLASHES = {
  kick: { size: 0.3, sizeByStrength: 0.14, height: 0.17 },
  snare: { size: 0.08, height: 0.035 },
  hat: { size: 0.032, height: 0.012 },
  maxTau: CIRCLE_TABLE.maxTau,
};
export const LIVELY_SPLASHES = {
  kick: { size: 0.34, sizeByStrength: 0.22, height: 0.32 },
  snare: { size: 0.09, height: 0.07 },
  hat: { size: 0.034, height: 0.024 },
  maxTau: LIVELY_TABLE.maxTau,
};
const STRENGTH_POWER = 1.5; // Strong kicks should turn out clearly higher.

// Bessel functions after Abramowitz & Stegun 9.4.1 to 9.4.6.
export function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const y = (x / 3) ** 2;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.00021)))));
  }
  const y = 3 / ax;
  const f = 0.79788456 + y * (-0.00000077 + y * (-0.0055274 + y * (-0.00009512 + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  const t = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return (f * Math.cos(t)) / Math.sqrt(ax);
}

export function besselJ1(x) {
  const ax = Math.abs(x);
  const sign = x < 0 ? -1 : 1;
  if (ax <= 3) {
    const y = (x / 3) ** 2;
    return x * (0.5 + y * (-0.56249985 + y * (0.21093573 + y * (-0.03954289 + y * (0.00443319 + y * (-0.00031761 + y * 0.00001109))))));
  }
  const y = 3 / ax;
  const f = 0.79788456 + y * (0.00000156 + y * (0.01659667 + y * (0.00017105 + y * (-0.00249511 + y * (0.00113653 + y * -0.00020033)))));
  const t = ax - 2.35619449 + y * (0.12499612 + y * (0.0000565 + y * (-0.00637879 + y * (0.00074348 + y * (0.00079824 + y * -0.00029166)))));
  return (sign * f * Math.cos(t)) / Math.sqrt(ax);
}

// Table over distance and time. Two values per entry: height (largest magnitude 1) and its derivative by distance.
export function bakeWaveTable(options = CIRCLE_TABLE) {
  const { radii: TABLE_RADII, times: TABLE_TIMES, maxRho: MAX_RHO, maxTau: MAX_TAU, wavenumbers: WAVENUMBERS, viscosity: VISCOSITY } = options;
  const dk = MAX_WAVENUMBER / WAVENUMBERS;
  const j0 = new Float64Array(TABLE_RADII * WAVENUMBERS);
  const j1 = new Float64Array(TABLE_RADII * WAVENUMBERS);
  const weights = new Float64Array(WAVENUMBERS);
  const rhoOf = (r) => (r * MAX_RHO) / (TABLE_RADII - 1);
  const tauOf = (t) => (t * MAX_TAU) / (TABLE_TIMES - 1);

  for (let i = 0; i < WAVENUMBERS; i++) {
    const k = (i + 0.5) * dk;
    weights[i] = k ** 3 * Math.exp(-1.5 * k * k) * dk; // without a zero-wavelength part: the water returns to equilibrium
    for (let r = 0; r < TABLE_RADII; r++) {
      j0[r * WAVENUMBERS + i] = besselJ0(k * rhoOf(r));
      j1[r * WAVENUMBERS + i] = besselJ1(k * rhoOf(r));
    }
  }

  const data = new Float32Array(TABLE_RADII * TABLE_TIMES * 2);
  const temporal = new Float64Array(WAVENUMBERS);
  const slopeWeight = new Float64Array(WAVENUMBERS);
  let largest = 0;
  for (let t = 0; t < TABLE_TIMES; t++) {
    const tau = tauOf(t);
    for (let i = 0; i < WAVENUMBERS; i++) {
      const k = (i + 0.5) * dk;
      // A push instead of an initial height: the sine starts at zero, the wave builds up instead of popping up.
      temporal[i] = -weights[i] * Math.sin(Math.sqrt(k) * tau) * Math.exp(-VISCOSITY * k * k * tau);
      slopeWeight[i] = -k * temporal[i];
    }
    for (let r = 0; r < TABLE_RADII; r++) {
      const row = r * WAVENUMBERS;
      let height = 0;
      let slope = 0;
      for (let i = 0; i < WAVENUMBERS; i++) {
        height += temporal[i] * j0[row + i];
        slope += slopeWeight[i] * j1[row + i];
      }
      const boostBase = 1 + rhoOf(r) / FAR_BOOST_RHO;
      const boost = boostBase ** FAR_BOOST_POWER;
      const boostSlope = (FAR_BOOST_POWER / FAR_BOOST_RHO) * boostBase ** (FAR_BOOST_POWER - 1);
      const boosted = height * boost;
      const index = (t * TABLE_RADII + r) * 2;
      data[index] = boosted;
      data[index + 1] = slope * boost + height * boostSlope;
      largest = Math.max(largest, Math.abs(boosted));
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= largest;
  return data;
}

// Reads the table like the graphics card: distance and time in table units, the result is the height.
export function sampleWaveTable(table, rho, tau, options = CIRCLE_TABLE) {
  const { radii: TABLE_RADII, times: TABLE_TIMES, maxRho: MAX_RHO, maxTau: MAX_TAU } = options;
  const r = Math.min(TABLE_RADII - 1, Math.round((rho / MAX_RHO) * (TABLE_RADII - 1)));
  const t = Math.min(TABLE_TIMES - 1, Math.round((tau / MAX_TAU) * (TABLE_TIMES - 1)));
  return table[(t * TABLE_RADII + r) * 2];
}

export const tauRate = (size) => Math.sqrt(GRAVITY / size);

// Manages the running pushes. The centre (0, 0) is directly below the visualizer.
export class WaveField {
  constructor({ random = Math.random, splashes = CIRCLE_SPLASHES } = {}) {
    this.random = random;
    this.splashes = splashes;
    this.events = [];
    this.time = 0;
    this.instances = new Float32Array(MAX_EVENTS * 5);
  }

  add({ x = 0, z = 0, size, height }) {
    if (height <= 0) return;
    if (this.events.length >= MAX_EVENTS) {
      // The weakest push gives way, not the oldest: a big ring should not break off because of many hi-hats.
      let weakest = 0;
      for (let i = 1; i < this.events.length; i++) if (this.events[i].height < this.events[weakest].height) weakest = i;
      if (this.events[weakest].height >= height) return;
      this.events.splice(weakest, 1);
    }
    this.events.push({ x, z, size, height, age: 0, rate: tauRate(size) });
  }

  splash(kind, strength, { waves = 1, vibration = 1 } = {}) {
    const offset = (radius) => {
      const angle = this.random() * Math.PI * 2;
      const distance = this.random() * radius;
      return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
    };
    const { kick: KICK, snare: SNARE, hat: HAT } = this.splashes;
    if (kind === 'kick') {
      const size = KICK.size + KICK.sizeByStrength * strength;
      this.add({ size, height: KICK.height * strength ** STRENGTH_POWER * waves });
    } else if (kind === 'snare') {
      this.add({ size: SNARE.size, height: SNARE.height * strength * vibration });
      for (let drop = 0; drop < SATELLITE_DROPS; drop++) {
        this.add({ ...offset(SPRAY_RADIUS), size: SNARE.size * 0.7, height: SNARE.height * 0.5 * strength * vibration });
      }
    } else {
      this.add({ ...offset(SPRAY_RADIUS), size: HAT.size, height: HAT.height * strength * vibration });
    }
  }

  // On a drop: one big ring in the middle and a circle of kick rings around it.
  dropSplash(strength, { waves = 1 } = {}) {
    const { kick: KICK } = this.splashes;
    const amount = 0.6 + 0.4 * strength;
    this.add({ size: KICK.size + KICK.sizeByStrength * DROP_SIZE, height: KICK.height * DROP_HEIGHT * amount * waves });
    for (let ring = 0; ring < DROP_RING_SPLASHES; ring++) {
      const angle = (ring / DROP_RING_SPLASHES) * Math.PI * 2 + this.random();
      this.add({
        x: Math.cos(angle) * DROP_RING_RADIUS,
        z: Math.sin(angle) * DROP_RING_RADIUS,
        size: KICK.size,
        height: KICK.height * amount * waves,
      });
    }
  }

  // `section` from the section detection; null turns off the splash on a drop.
  update(deltaSeconds, beat, settings, section = null) {
    this.time += deltaSeconds;
    for (const event of this.events) event.age += deltaSeconds;
    this.events = this.events.filter((event) => event.age * event.rate < this.splashes.maxTau);
    if (section?.drop) this.dropSplash(section.dropStrength, settings);
    for (const kind of ['kick', 'snare', 'hat']) {
      if (beat[kind].hit) this.splash(kind, Math.max(0.2, beat[kind].level), settings);
    }
  }

  // Data per push for the graphics card: x, z, size, height, time in table units.
  writeInstances() {
    this.events.forEach((event, index) => {
      this.instances.set([event.x, event.z, event.size, event.height, event.age * event.rate], index * 5);
    });
    return this.events.length;
  }
}

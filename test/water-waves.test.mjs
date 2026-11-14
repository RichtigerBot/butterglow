// Tests the wave physics of the ripples without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  besselJ0,
  besselJ1,
  bakeWaveTable,
  MAX_RHO,
  MAX_TAU,
  sampleWaveTable,
  tauRate,
  WaveField,
} from '../src/effects/water-waves.js';

const table = bakeWaveTable();
const quiet = () => ({ kick: { hit: false, level: 0 }, snare: { hit: false, level: 0 }, hat: { hit: false, level: 0 } });
const hit = (kind, level = 1) => ({ ...quiet(), [kind]: { hit: true, level } });
const full = { waves: 1, vibration: 1 };

// Distance at which the wave is first noticeable at time tau.
function frontAt(tau) {
  for (let rho = MAX_RHO; rho > 0; rho -= 0.25) {
    if (Math.abs(sampleWaveTable(table, rho, tau)) > 0.03) return rho;
  }
  return 0;
}

// Distance between neighbouring zero crossings around a distance: the local wavelength.
function wavelengthNear(rho, tau) {
  const crossings = [];
  let previous = sampleWaveTable(table, Math.max(0, rho - 15), tau);
  for (let current = Math.max(0, rho - 15) + 0.2; current < rho + 15 && current < MAX_RHO; current += 0.2) {
    const value = sampleWaveTable(table, current, tau);
    if (value * previous < 0) crossings.push(current);
    previous = value;
  }
  return crossings.length < 2 ? Infinity : (2 * (crossings.at(-1) - crossings[0])) / (crossings.length - 1);
}

test('Bessel-Funktionen stimmen', () => {
  assert.ok(Math.abs(besselJ0(0) - 1) < 1e-6);
  assert.ok(Math.abs(besselJ0(2.404826)) < 1e-4);
  assert.ok(Math.abs(besselJ0(10) + 0.2459358) < 1e-4);
  assert.ok(Math.abs(besselJ1(1) - 0.4400506) < 1e-4);
  assert.ok(Math.abs(besselJ1(10) - 0.0434727) < 1e-4);
});

test('The wave starts at zero instead of popping up', () => {
  assert.ok(Math.abs(sampleWaveTable(table, 0, 0)) < 1e-6);
});

test('The rings run outwards', () => {
  const fronts = [10, 30, 60, 100].map(frontAt);
  for (let i = 1; i < fronts.length; i++) assert.ok(fronts[i] > fronts[i - 1] + 2, fronts.join(' '));
});

test('As with real water, long waves run ahead, short ones behind', () => {
  const tau = 100;
  const front = frontAt(tau);
  const leading = wavelengthNear(front - 15, tau);
  const trailing = wavelengthNear(front * 0.35, tau);
  assert.ok(leading > trailing * 1.5, `vorn ${leading}, hinten ${trailing}`);
});

test('The table value stays bounded and fades again close to the impact', () => {
  const largest = table.reduce((max, value, index) => (index % 2 === 0 ? Math.max(max, Math.abs(value)) : max), 0);
  assert.ok(Math.abs(largest - 1) < 1e-6);
  assert.ok(Math.abs(sampleWaveTable(table, 1, MAX_TAU)) < 0.15);
});

test('Without a beat no ring is created', () => {
  const field = new WaveField();
  for (let i = 0; i < 300; i++) field.update(1 / 60, quiet(), full);
  assert.equal(field.events.length, 0);
});

test('Stronger kicks make higher and longer waves', () => {
  const field = new WaveField();
  field.update(1 / 60, hit('kick', 0.4), full);
  field.update(1 / 60, hit('kick', 1), full);
  const [soft, strong] = field.events;
  assert.ok(strong.height > soft.height * 2);
  assert.ok(strong.size > soft.size);
});

test('Hi-hat is finer than snare, snare finer than kick', () => {
  const sizeOf = (kind) => {
    const field = new WaveField();
    field.update(1 / 60, hit(kind), full);
    return field.events[0].size;
  };
  assert.ok(sizeOf('hat') < sizeOf('snare'));
  assert.ok(sizeOf('snare') < sizeOf('kick'));
  // Short waves oscillate faster; that is the "matching frequency".
  assert.ok(tauRate(sizeOf('hat')) > tauRate(sizeOf('kick')) * 2);
});

test('The kick hits exactly below the visualizer', () => {
  const field = new WaveField();
  field.update(1 / 60, hit('kick'), full);
  assert.deepEqual([field.events[0].x, field.events[0].z], [0, 0]);
});

test('Sliders at zero turn off the respective source', () => {
  const field = new WaveField();
  field.update(1 / 60, hit('kick'), { waves: 0, vibration: 1 });
  field.update(1 / 60, hit('snare'), { waves: 1, vibration: 0 });
  field.update(1 / 60, hit('hat'), { waves: 1, vibration: 0 });
  assert.equal(field.events.length, 0);
});

test('Rings end, and many hi-hats do not push out a kick', () => {
  const field = new WaveField();
  field.update(1 / 60, hit('kick'), full);
  for (let i = 0; i < 200; i++) field.update(0.001, hit('hat'), full);
  assert.ok(field.events.length <= 64);
  assert.ok(field.events.some((event) => event.size > 0.2));
  for (let i = 0; i < 500; i++) field.update(1 / 60, quiet(), full);
  assert.equal(field.events.length, 0);
});

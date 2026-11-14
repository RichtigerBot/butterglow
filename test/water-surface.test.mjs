// Tests the wave physics of the water without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaterSurface } from '../src/effects/water-surface.js';

const quiet = () => ({
  kick: { hit: false, level: 0 },
  snare: { hit: false, level: 0 },
  hat: { hit: false, level: 0 },
});

function simulate(seconds, events = () => quiet(), settings) {
  const surface = new WaterSurface();
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame++) surface.update(1 / 60, events(frame), settings);
  return surface;
}

const range = (values) => Math.max(...values) - Math.min(...values);

// Share of fine movement: difference between neighbouring points compared with the overall height.
const roughness = (values) => {
  let sum = 0;
  for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  return sum / values.length;
};

const kickAt = (frameNumber, level) => (frame) => ({ ...quiet(), kick: { hit: frame === frameNumber, level } });

test('Without a beat the water stays calm', () => {
  const { heights } = simulate(5);
  assert.ok(range(heights) < 0.25, `Spanne ${range(heights)}`);
});

test('A stronger kick makes higher waves', () => {
  const weak = simulate(0.35, kickAt(0, 0.5));
  const strong = simulate(0.35, kickAt(0, 1));
  assert.ok(range(strong.swell) > range(weak.swell) * 1.8, `${range(weak.swell)} / ${range(strong.swell)}`);
  assert.ok(range(strong.swell) > 0.5, `Welle ${range(strong.swell)}`);
});

test('Waves run outwards from the kick', () => {
  // The highest point of the right half moves away from the middle.
  const peakPosition = (swell) => {
    const half = swell.subarray(swell.length / 2);
    return half.indexOf(Math.max(...half));
  };
  const early = peakPosition(simulate(0.15, kickAt(0, 1)).swell);
  const late = peakPosition(simulate(0.6, kickAt(0, 1)).swell);
  assert.ok(late > early + 10, `${early} / ${late}`);
});

test('Waves decay again', () => {
  const surface = simulate(8, kickAt(0, 1));
  assert.ok(range(surface.swell) < 0.15, `Spanne ${range(surface.swell)}`);
});

test('Sustained kicks stay stable', () => {
  const surface = simulate(60, (frame) => ({ ...quiet(), kick: { hit: frame % 28 === 0, level: 1 } }));
  assert.ok(Math.max(...surface.swell.map(Math.abs)) < 6, `height ${Math.max(...surface.swell.map(Math.abs))}`);
  assert.ok(surface.heights.every(Number.isFinite));
});

test('A low frame rate stays stable', () => {
  const surface = new WaterSurface();
  for (let frame = 0; frame < 300; frame++) {
    surface.update(0.1, { ...quiet(), kick: { hit: frame % 5 === 0, level: 1 } });
  }
  assert.ok(surface.heights.every(Number.isFinite));
  assert.ok(Math.max(...surface.swell.map(Math.abs)) < 6);
});

test('Hi-hat vibrates more finely than the snare', () => {
  const snare = simulate(0.1, (frame) => ({ ...quiet(), snare: { hit: frame === 3, level: 1 } }));
  const hat = simulate(0.1, (frame) => ({ ...quiet(), hat: { hit: frame === 3, level: 1 } }));
  const calm = simulate(0.1);
  assert.ok(roughness(snare.heights) > roughness(calm.heights) * 3);
  assert.ok(roughness(hat.heights) > roughness(calm.heights) * 3);

  // Counts sign changes of the vibration part: many changes mean a fine pattern.
  const crossings = (surface) => {
    let count = 0;
    let previous = 0;
    surface.heights.forEach((height, i) => {
      const value = height - calm.heights[i];
      if (value * previous < 0) count++;
      if (value !== 0) previous = value;
    });
    return count;
  };
  assert.ok(crossings(hat) > crossings(snare) * 1.8, `${crossings(snare)} / ${crossings(hat)}`);
});

test('The sliders from the menu take effect', () => {
  const withoutWaves = simulate(0.35, kickAt(0, 1), { waves: 0 });
  assert.equal(range(withoutWaves.swell), 0);
  const without = simulate(0.1, (frame) => ({ ...quiet(), snare: { hit: frame === 3, level: 1 } }), { vibration: 0 });
  const calm = simulate(0.1);
  assert.ok(Math.abs(roughness(without.heights) - roughness(calm.heights)) < 1e-6);
});

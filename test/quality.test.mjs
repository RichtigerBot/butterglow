import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoQuality, createQuality } from '../src/ui/quality.js';

// Plays `seconds` seconds at a fixed frame rate and counts how often the level changes.
function run(auto, { fps, seconds, start = 0 }) {
  let changes = 0;
  const step = 1000 / fps;
  let now = start;
  for (; now < start + seconds * 1000; now += step) if (auto.frame(now)) changes++;
  return { changes, end: now };
}

test('At 60 frames the level stays High', () => {
  const auto = new AutoQuality();
  run(auto, { fps: 60, seconds: 60 });
  assert.equal(auto.level.id, 'high');
});

test('A steady 30 frames goes down level by level', () => {
  const auto = new AutoQuality();
  let { end } = run(auto, { fps: 30, seconds: 5 });
  assert.equal(auto.level.id, 'medium');
  ({ end } = run(auto, { fps: 30, seconds: 60, start: end }));
  assert.equal(auto.level.id, 'lowest');
});

test('A short dip does not lower the level', () => {
  const auto = new AutoQuality();
  let { end } = run(auto, { fps: 60, seconds: 10 });
  ({ end } = run(auto, { fps: 25, seconds: 2, start: end }));
  run(auto, { fps: 60, seconds: 10, start: end });
  assert.equal(auto.level.id, 'high');
});

test('With enough headroom it goes back up, but not right away to a level that was just too slow', () => {
  const auto = new AutoQuality();
  let { end } = run(auto, { fps: 30, seconds: 5 });
  assert.equal(auto.level.id, 'medium');
  ({ end } = run(auto, { fps: 60, seconds: 60, start: end }));
  assert.equal(auto.level.id, 'medium', 'High was just too slow and stays locked for a while');
  run(auto, { fps: 60, seconds: 90, start: end });
  assert.equal(auto.level.id, 'high');
});

test('Pauses (tab in the background) do not count as slow frames', () => {
  const auto = new AutoQuality();
  for (let now = 0; now < 60000; now += 1000) auto.frame(now);
  assert.equal(auto.level.id, 'high');
});

test('A fixed level ignores the frame rate and reports the new resolution', () => {
  const settings = { quality: 'low' };
  const scales = [];
  const quality = createQuality({ settings, onScaleChange: (scale) => scales.push(scale) });
  assert.equal(quality.scale, 0.5);
  for (let now = 0; now < 20000; now += 1000 / 20) quality.frame(now);
  assert.equal(quality.scale, 0.5);
  settings.quality = 'high';
  quality.applySettings();
  assert.deepEqual(scales, [1]);
});

test('With a frame limit of 30 the level stays High if the 30 are reached', () => {
  const auto = new AutoQuality();
  auto.target = 30;
  run(auto, { fps: 30, seconds: 30 });
  assert.equal(auto.level.id, 'high');
  run(auto, { fps: 18, seconds: 6, start: 30000 });
  assert.equal(auto.level.id, 'medium');
});

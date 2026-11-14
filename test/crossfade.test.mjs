// Tests the cross-fade when switching visualizers, without a browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { crossfadeAmount, transitionSettings } from '../src/ui/crossfade.js';

test('Cross-fade runs smoothly from 0 to 1', () => {
  assert.equal(crossfadeAmount(0, 1000), 0);
  assert.equal(crossfadeAmount(500, 1000), 0.5);
  assert.equal(crossfadeAmount(1000, 1000), 1);
  assert.equal(crossfadeAmount(5000, 1000), 1);
  assert.equal(crossfadeAmount(-10, 1000), 0);
  // Slower than linear at the start, faster in the middle.
  assert.ok(crossfadeAmount(100, 1000) < 0.1);
  assert.ok(crossfadeAmount(550, 1000) - crossfadeAmount(450, 1000) > 0.1);
  // Without a duration, done immediately.
  assert.equal(crossfadeAmount(0, 0), 1);
});

test('Setting: Normal (1 s) is the default, Off is possible', () => {
  const [field] = transitionSettings;
  assert.equal(field.default, '1000');
  assert.ok(field.options.some((option) => option.value === '0'));
});

test('Milkdrop draws on every monitor at the set frame rate on average', async () => {
  const { createFrameGate } = await import('../src/ui/frame-gate.js');
  const drawnPerSecond = (hz, rate, seconds = 5) => {
    const gate = createFrameGate();
    let drawn = 0;
    // slight jitter in the frame times, as with real monitors
    for (let i = 0; i < hz * seconds; i++) if (!gate((i * 1000) / hz + (i % 3) * 0.3, rate)) drawn++;
    return drawn / seconds;
  };
  for (const hz of [60, 120, 144, 165, 240]) assert.ok(Math.abs(drawnPerSecond(hz, 60) - 60) <= 1, `${hz} Hz: ${drawnPerSecond(hz, 60)}`);
  assert.ok(Math.abs(drawnPerSecond(240, 120) - 120) <= 1);
  assert.equal(drawnPerSecond(240, 0), 240); // monitor refresh rate
  assert.ok(Math.abs(drawnPerSecond(50, 60) - 50) <= 1); // slow monitor: every frame
});

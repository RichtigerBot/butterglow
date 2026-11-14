// Tests the decisions of the automatic visualizer switch without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoSwitchSettingsFor, createAutoSwitch } from '../src/ui/auto-switch.js';

const visualizers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const defaults = Object.fromEntries(autoSwitchSettingsFor(visualizers).map(({ id, default: value }) => [id, value]));

function setup(overrides = {}) {
  const settings = { ...defaults, mode: 'drop', ...overrides };
  return { settings, auto: createAutoSwitch({ visualizers, settings, transitionMs: () => 1000 }) };
}
const section = (fields = {}) => ({ name: 'normal', drop: false, dropIn: null, dropConfirmed: false, ...fields });
const frame = (fields, kick = false) => ({ section: section(fields), beat: { kick: { hit: kick } } });

test('Off: no switch, not even on the drop', () => {
  const { auto } = setup({ mode: 'off' });
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({ drop: true }), 100, { current: 0 }), null);
});

test('On the drop to the next visualizer, but not before the set time', () => {
  const { auto } = setup({ minSeconds: 20 });
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({ drop: true }), 10, { current: 0 }), null);
  assert.deepEqual(auto.update(frame({ drop: true }), 25, { current: 0 }), { index: 1, durationMs: 300, reason: 'drop' });
  assert.equal(auto.update(frame({ drop: true }), 30, { current: 1 }), null, 'right after that too early again');
});

test('Hard cut on the drop', () => {
  const { auto } = setup({ dropTransition: 'cut' });
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({ drop: true }), 30, { current: 0 }).durationMs, 0);
});

test('With lookahead the cross-fade starts earlier and ends on the drop', () => {
  const { auto } = setup();
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({ dropIn: 0.3, dropConfirmed: false }), 30, { current: 0 }), null, 'not yet while unconfirmed');
  const decision = auto.update(frame({ dropIn: 0.22, dropConfirmed: true }), 30.1, { current: 0 });
  assert.equal(decision.index, 1);
  assert.ok(Math.abs(decision.durationMs - 220) < 1, `cross-fade ${decision.durationMs} ms`);
  assert.equal(auto.update(frame({ drop: true }), 30.32, { current: 1 }), null, 'the drop itself does not switch again');
});

test('Sections: at the start of a quiet part with the normal cross-fade', () => {
  const drop = setup({ mode: 'drop' }).auto;
  const sections = setup({ mode: 'sections' }).auto;
  for (const auto of [drop, sections]) auto.update(frame({ name: 'drop' }), 0, { current: 0 });
  assert.equal(drop.update(frame({ name: 'quiet' }), 30, { current: 0 }), null);
  assert.deepEqual(sections.update(frame({ name: 'quiet' }), 30, { current: 0 }), { index: 1, durationMs: 1000, reason: 'quiet' });
  assert.equal(sections.update(frame({ name: 'quiet' }), 60, { current: 1 }), null, 'only at the start');
});

test('At the latest after the set time, on the next kick', () => {
  const { auto } = setup({ maxSeconds: 120 });
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({}, true), 100, { current: 0 }), null);
  assert.equal(auto.update(frame({}, false), 121, { current: 0 }), null, 'waits for the kick');
  assert.equal(auto.update(frame({}, true), 121.5, { current: 0 }).reason, 'time');
});

test('Only visualizers that take part, and a manual switch resets the time', () => {
  const { auto } = setup({ 'use-b': false });
  auto.update(frame(), 0, { current: 0 });
  assert.equal(auto.update(frame({ drop: true }), 30, { current: 0 }).index, 2);
  auto.noteSwitch(50);
  assert.equal(auto.update(frame({ drop: true }), 60, { current: 2 }), null);
  assert.equal(auto.update(frame({ drop: true }), 75, { current: 2 }).index, 0);
});

test('No switch while something is open or only the running visualizer takes part', () => {
  const busy = setup().auto;
  busy.update(frame(), 0, { current: 0 });
  assert.equal(busy.update(frame({ drop: true }), 30, { current: 0, busy: true }), null);
  const alone = setup({ 'use-b': false, 'use-c': false }).auto;
  alone.update(frame(), 0, { current: 0 });
  assert.equal(alone.update(frame({ drop: true }), 30, { current: 0 }), null);
});

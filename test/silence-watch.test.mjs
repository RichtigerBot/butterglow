import assert from 'node:assert/strict';
import test from 'node:test';
import { createSilenceWatch, protectedServiceName, SILENCE_PEAK, SILENCE_SECONDS } from '../src/audio/silence-watch.js';

function setup({ playing = true, site = 'open.spotify.com' } = {}) {
  const calls = { silent: [], sound: 0, asked: 0 };
  const input = { peak: 0 };
  const watch = createSilenceWatch({
    readPeak: () => input.peak,
    readTab: async () => {
      calls.asked++;
      return { playing, site };
    },
    onSilent: (service) => calls.silent.push(service),
    onSound: () => calls.sound++,
  });
  return { watch, calls, input };
}

test('Known services are named by host, including subdomains', () => {
  assert.equal(protectedServiceName('open.spotify.com'), 'Spotify');
  assert.equal(protectedServiceName('www.netflix.com'), 'Netflix');
  assert.equal(protectedServiceName('listen.tidal.com'), 'Tidal');
  assert.equal(protectedServiceName('www.youtube.com'), null);
  assert.equal(protectedServiceName('notspotify.com'), null);
  assert.equal(protectedServiceName(undefined), null);
});

test('Silence while the tab plays leads to one hint, only after the waiting time', async () => {
  const { watch, calls } = setup();
  for (let second = 0; second < SILENCE_SECONDS; second++) await watch.check(second);
  assert.deepEqual(calls.silent, []);
  assert.equal(calls.asked, 0, 'the tab is not asked before the silence lasts');
  await watch.check(SILENCE_SECONDS);
  assert.deepEqual(calls.silent, ['Spotify']);
  await watch.check(SILENCE_SECONDS + 5);
  assert.deepEqual(calls.silent, ['Spotify'], 'reported only once');
});

test('Unknown sites get the general hint', async () => {
  const { watch, calls } = setup({ site: 'example.org' });
  await watch.check(0);
  await watch.check(SILENCE_SECONDS);
  assert.deepEqual(calls.silent, [null]);
});

test('A paused tab is silent without a hint', async () => {
  const { watch, calls } = setup({ playing: false });
  await watch.check(0);
  await watch.check(SILENCE_SECONDS + 10);
  assert.deepEqual(calls.silent, []);
});

test('Sound ends the hint and starts the waiting time again', async () => {
  const { watch, calls, input } = setup();
  await watch.check(0);
  await watch.check(SILENCE_SECONDS);
  input.peak = SILENCE_PEAK * 10;
  await watch.check(SILENCE_SECONDS + 1);
  assert.equal(calls.sound, 1);
  input.peak = 0;
  await watch.check(SILENCE_SECONDS + 2);
  await watch.check(SILENCE_SECONDS + 3);
  assert.equal(calls.silent.length, 1, 'short silence after sound does not report again');
  await watch.check(2 * SILENCE_SECONDS + 2);
  assert.equal(calls.silent.length, 2);
});

test('Quiet music above the threshold never counts as silence', async () => {
  const { watch, calls, input } = setup();
  input.peak = SILENCE_PEAK * 2;
  for (let second = 0; second < 30; second++) await watch.check(second);
  assert.deepEqual(calls.silent, []);
  assert.equal(calls.asked, 0);
});

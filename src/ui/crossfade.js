// Smooth transitions when switching the visualizer (V key or menu).
// The new visualizer is immediately underneath and running. The old one lies on top, keeps running and turns transparent.
// So both pictures are moving during the cross-fade. Afterwards the old one is hidden and no longer drawn.

export const transitionSettings = [
  {
    id: 'transition',
    label: 'settings.display.transition',
    type: 'select',
    default: '1000',
    options: [
      { value: '0', label: 'settings.off' },
      { value: '500', label: 'settings.display.transitionShort' },
      { value: '1000', label: 'settings.display.transitionNormal' },
      { value: '2000', label: 'settings.display.transitionLong' },
    ],
  },
];

// Share of the new picture, 0 to 1. Soft at the start and at the end (smoothstep).
export function crossfadeAmount(elapsed, duration) {
  if (!(duration > 0)) return 1;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return t * t * (3 - 2 * t);
}

// A water reflection needs a mixed source during the cross-fade, otherwise it jumps.
// Half resolution is enough for that; the water scales down anyway.
const MIX_SCALE = 0.5;

export function createCrossfade() {
  let fade = null; // { from, to, start, duration, frames, mixedFrames }
  let last = null; // figures of the last transition, for tests and debugging
  let mix = null;
  let mixContext = null;

  function finish() {
    if (!fade) return;
    const { from, to, duration, frames } = fade;
    last = { duration, frames };
    from.canvas.hidden = true;
    from.canvas.style.opacity = '';
    to.canvas.style.zIndex = '';
    fade = null;
  }

  function mixed(from, to, amount) {
    const width = Math.max(1, Math.round(to.canvas.width * MIX_SCALE));
    const height = Math.max(1, Math.round(to.canvas.height * MIX_SCALE));
    if (!mix) {
      mix = document.createElement('canvas');
      mixContext = mix.getContext('2d', { alpha: false });
    }
    if (mix.width !== width || mix.height !== height) Object.assign(mix, { width, height });
    mixContext.globalAlpha = 1;
    mixContext.drawImage(to.canvas, 0, 0, width, height);
    mixContext.globalAlpha = 1 - amount;
    mixContext.drawImage(from.canvas, 0, 0, width, height);
    return mix;
  }

  return {
    get running() {
      return fade !== null;
    },
    // { duration, frames }: how long and with how many mixed frames the last transition ran.
    get last() {
      return last;
    },
    // `from` is the previous visualizer, `to` the new one (already visible). Without `from` or duration: hard switch.
    start(from, to, duration) {
      finish(); // a running transition ends immediately, otherwise three pictures would be stacked
      if (!from || from === to || !(duration > 0)) {
        if (from && from !== to) from.canvas.hidden = true;
        return;
      }
      from.canvas.hidden = false;
      from.canvas.style.opacity = '1';
      to.canvas.style.zIndex = '-1'; // below the old one, but inside the stage (isolation: isolate) and below the water
      // The clock only starts with the first drawn frame. If that takes a while (new visualizer, compiling shaders),
      // the cross-fade would otherwise be over before it can be seen.
      fade = { from, to, start: null, duration, frames: 0 };
    },
    finish,
    // Once per frame, after the new visualizer has drawn. Draws the old one and sets its opacity.
    // Returns the source for the water (mixed while the transition runs), otherwise null.
    render(frame, now = performance.now(), { needsMix = false } = {}) {
      if (!fade) return null;
      fade.start ??= now;
      const amount = crossfadeAmount(now - fade.start, fade.duration);
      if (amount >= 1) {
        finish();
        return null;
      }
      const { from, to } = fade;
      fade.frames++;
      from.render(frame);
      from.canvas.style.opacity = String(1 - amount);
      return needsMix ? mixed(from, to, amount) : null;
    },
  };
}

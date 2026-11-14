// Render loop with an adjustable frame limit (for the debug view).
//
// Normally ('vsync') everything runs via requestAnimationFrame, i.e. exactly at the monitor's refresh rate.
// With a limit, an own loop runs via MessageChannel. It is not bound to the monitor
// and can therefore compute 1000 frames per second or more. Still only as many are visible as the
// monitor shows. The other frames measure how much headroom graphics card and processor still have.
import { t } from '../i18n/i18n.js';

// Steps of the slider. 'vsync' = monitor refresh rate, Infinity = unlimited.
export const FRAME_LIMITS = ['vsync', 15, 24, 30, 45, 60, 75, 90, 120, 144, 165, 240, 360, 500, 750, 1000, Infinity];

export function frameLimitLabel(limit) {
  if (limit === 'vsync') return t('settings.milkdrop.vsync');
  if (limit === Infinity) return t('debug.unlimited');
  return t('settings.milkdrop.fps', { value: limit });
}

const COARSE_WAIT_MS = 4; // setTimeout wakes up this much earlier; the loop waits out the rest precisely
const HIDDEN_WAIT_MS = 250; // do not keep computing in the background

export function createFrameScheduler(render) {
  let limit = 'vsync';
  let generation = 0; // every change ends the old loop
  let next = 0;
  const channel = new MessageChannel();

  function vsyncLoop(mine) {
    const step = (now) => {
      if (mine !== generation) return;
      render(now);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function timedLoop(mine) {
    const poke = () => channel.port2.postMessage(mine);
    channel.port1.onmessage = ({ data }) => {
      if (data !== generation) return;
      if (document.hidden) {
        setTimeout(poke, HIDDEN_WAIT_MS);
        return;
      }
      const now = performance.now();
      if (limit === Infinity) {
        render(now);
        poke();
        return;
      }
      const interval = 1000 / limit;
      const wait = next - now;
      if (wait <= 0) {
        render(now);
        // Fixed pace. Whoever falls far behind (stutter) does not catch up with many fast frames.
        next = now - next > interval ? now + interval : next + interval;
        poke();
      } else if (wait > COARSE_WAIT_MS + 1) {
        setTimeout(poke, wait - COARSE_WAIT_MS);
      } else {
        poke();
      }
    };
    next = performance.now();
    poke();
  }

  function start() {
    generation++;
    if (limit === 'vsync') vsyncLoop(generation);
    else timedLoop(generation);
  }

  return {
    get limit() {
      return limit;
    },
    setLimit(value) {
      const valid = FRAME_LIMITS.includes(value) ? value : 'vsync';
      if (valid === limit && generation > 0) return;
      limit = valid;
      start();
    },
    start,
  };
}

// Quality levels: all pictures (visualizer, water, reflection) are computed at a lower resolution
// and scaled up to the window. On weak graphics cards this saves the most.
// "Automatic" starts with High, goes one level down when the frame rate stays low and
// later carefully back up.

export const QUALITY_LEVELS = [
  { id: 'high', label: 'settings.quality.high', scale: 1 },
  { id: 'medium', label: 'settings.quality.medium', scale: 0.75 },
  { id: 'low', label: 'settings.quality.low', scale: 0.5 },
  { id: 'lowest', label: 'settings.quality.lowest', scale: 0.35 },
];

export const qualitySettings = [
  {
    id: 'quality',
    label: 'settings.quality.label',
    type: 'select',
    default: 'auto',
    options: [{ value: 'auto', label: 'settings.quality.auto' }, ...QUALITY_LEVELS.map(({ id, label }) => ({ value: id, label }))],
  },
];

const WINDOW_MS = 2000; // how long to count before deciding
const LOW_FPS = 45; // below this it visibly stutters
const GOOD_FPS = 57; // above this there is room for more
const LOW_WINDOWS_TO_STEP_DOWN = 2; // 4 s in a row too slow
const GOOD_WINDOWS_TO_STEP_UP = 10; // 20 s in a row fast enough
const FAILED_LOCK_MS = 120000; // a level that was just too slow is not tried again for 2 minutes
const GAP_MS = 250; // longer pauses (tab in the background) do not count

// Pure logic without DOM, so it can be tested with made-up frame times.
export class AutoQuality {
  constructor() {
    this.index = 0;
    this.target = Infinity; // frame limit from the debug view, otherwise unlimited
    this.reset();
    this.lockedUntil = new Map(); // level → time from which it may be tried again
  }

  reset() {
    this.windowStart = null;
    this.frames = 0;
    this.lowWindows = 0;
    this.goodWindows = 0;
    this.lastFps = null;
  }

  get level() {
    return QUALITY_LEVELS[this.index];
  }

  // Call for every frame with its timestamp. Returns true if the level has changed.
  frame(now) {
    if (this.last !== undefined && now - this.last > GAP_MS) this.windowStart = null;
    this.last = now;
    if (this.windowStart === null) {
      this.windowStart = now;
      this.frames = 0;
      return false;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) return false;

    const fps = (this.frames * 1000) / elapsed;
    this.lastFps = fps;
    this.windowStart = now;
    this.frames = 0;
    // With a low frame limit, what counts is whether it is reached, not the fixed 45 and 57.
    const low = Math.min(LOW_FPS, this.target * 0.75);
    const good = Math.min(GOOD_FPS, this.target * 0.95);
    this.lowWindows = fps < low ? this.lowWindows + 1 : 0;
    this.goodWindows = fps >= good ? this.goodWindows + 1 : 0;

    if (this.lowWindows >= LOW_WINDOWS_TO_STEP_DOWN && this.index < QUALITY_LEVELS.length - 1) {
      this.lockedUntil.set(this.index, now + FAILED_LOCK_MS);
      return this.#move(1);
    }
    const higher = this.index - 1;
    if (this.goodWindows >= GOOD_WINDOWS_TO_STEP_UP && higher >= 0 && (this.lockedUntil.get(higher) ?? 0) <= now) {
      return this.#move(-1);
    }
    return false;
  }

  #move(step) {
    this.index += step;
    this.lowWindows = 0;
    this.goodWindows = 0;
    // The first window after the change does not count; the new resolution needs a moment.
    this.windowStart = null;
    return true;
  }
}

// Connects the setting with the automatic mode. `onScaleChange` is called when the resolution should change.
export function createQuality({ settings, onScaleChange }) {
  const auto = new AutoQuality();
  let scale = currentLevel().scale;

  function currentLevel() {
    if (settings.quality === 'auto') return auto.level;
    return QUALITY_LEVELS.find((level) => level.id === settings.quality) ?? QUALITY_LEVELS[0];
  }

  function update() {
    const next = currentLevel().scale;
    if (next === scale) return;
    scale = next;
    onScaleChange(scale);
  }

  return {
    get scale() {
      return scale;
    },
    get level() {
      return currentLevel();
    },
    get auto() {
      return settings.quality === 'auto';
    },
    get measuredFps() {
      return auto.lastFps;
    },
    // Frame limit from the debug view: 'vsync', a number or Infinity.
    setTarget(limit) {
      auto.target = typeof limit === 'number' ? limit : Infinity;
      auto.reset();
    },
    frame(now) {
      if (settings.quality !== 'auto') return;
      if (auto.frame(now)) update();
    },
    // Call after a change in the menu.
    applySettings() {
      auto.reset();
      update();
    },
  };
}

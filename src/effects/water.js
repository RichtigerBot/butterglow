// Water below the visualizer: picks up the current picture and reacts to kick, snare and hi-hat.
import { CLASSIC_MAX_RENDER_WIDTH, createClassicWater } from './water-classic.js';
import { createCircleWater } from './water-circles.js';
import { createLivelyWater } from './water-lively.js';

// Presets with a water surface in perspective. They need float rendering, otherwise only "Classic" is left.
const SURFACE_PRESETS = { lively: createLivelyWater, ripples: createCircleWater };

// Whether the water shows is set per visualizer (see waterToggle); `settings.enabled` is provided by the caller.
export const waterToggle = (enabledByDefault) => ({ id: 'water', label: 'settings.water.enabled', type: 'toggle', default: enabledByDefault });

export const waterSettings = [
  {
    id: 'preset',
    label: 'settings.water.preset',
    type: 'select',
    default: 'lively',
    options: [
      { value: 'lively', label: 'settings.water.lively' },
      { value: 'ripples', label: 'settings.water.ripples' },
      { value: 'classic', label: 'settings.water.classic' },
    ],
  },
  { id: 'strength', label: 'settings.water.strength', type: 'range', min: 0, max: 300, step: 5, default: 100, unit: ' %' },
  { id: 'level', label: 'settings.water.level', type: 'range', min: 8, max: 40, default: 20, unit: ' %' },
  { id: 'waves', label: 'settings.water.waves', type: 'range', min: 0, max: 200, default: 100, unit: ' %' },
  { id: 'vibration', label: 'settings.water.vibration', type: 'range', min: 0, max: 200, default: 100, unit: ' %' },
  { id: 'reflection', label: 'settings.water.reflection', type: 'range', min: 0, max: 100, default: 70, unit: ' %' },
  { id: 'dropSplash', label: 'settings.water.dropSplash', type: 'toggle', default: true },
];

export function createWater({ stage, settings }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'water';
  stage.append(canvas);

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL 2 is not available.');

  const classic = createClassicWater(gl, settings);
  const surfaces = new Map();
  const failed = new Set();
  let lastTime = performance.now() / 1000;
  let size = null;
  let appliedPreset = null;

  // The wave tables take some time at startup, so they are only created when a preset needs them.
  function activePreset() {
    const preset = SURFACE_PRESETS[settings.preset] ? settings.preset : 'classic';
    if (preset === 'classic' || failed.has(preset)) return 'classic';
    if (!surfaces.has(preset)) {
      try {
        surfaces.set(preset, SURFACE_PRESETS[preset](gl, settings));
      } catch (error) {
        console.warn('Water preset not available:', preset, error);
        failed.add(preset);
        return 'classic';
      }
    }
    return preset;
  }

  function applySize(preset) {
    if (!size) return;
    const [width, height, pixelRatio] = size;
    const limit = preset === 'classic' ? Math.min(1, CLASSIC_MAX_RENDER_WIDTH / (width * pixelRatio)) : 1;
    canvas.width = Math.round(width * pixelRatio * limit);
    canvas.height = Math.round(height * pixelRatio * limit);
    appliedPreset = preset;
  }

  return {
    canvas,
    settings,
    surface: classic.surface,
    // The currently visible water with a surface in perspective, otherwise null.
    get ripples() {
      return surfaces.get(appliedPreset) ?? null;
    },
    resize(width, height, pixelRatio) {
      size = [width, height, pixelRatio];
      appliedPreset = null;
    },
    // Call right after the visualizer: only then is its WebGL picture still readable.
    render(frame, source) {
      const now = performance.now() / 1000;
      const deltaSeconds = Math.min(0.1, now - lastTime);
      lastTime = now;

      canvas.hidden = !settings.enabled;
      if (!settings.enabled) return;

      const preset = activePreset();
      if (preset !== appliedPreset) applySize(preset);
      (preset === 'classic' ? classic : surfaces.get(preset)).render(deltaSeconds, frame, source);
    },
  };
}

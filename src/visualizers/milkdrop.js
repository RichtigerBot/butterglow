import butterchurn from 'butterchurn';
import imageData from 'butterchurn-presets/imageData.js';
import { t } from '../i18n/i18n.js';
import { shaderErrorsFromLog } from '../milk/preset-check.js';
import { SHADER_PARTS } from '../milk/preset-model.js';
import { withFixedShaders } from '../milk/shader-fix.js';
import { waterToggle } from '../effects/water.js';
import { createFrameGate } from '../ui/frame-gate.js';

// Many presets count frames instead of seconds (frame, own counters, decay per frame). They are built for about 60 frames/s
// and run four times as fast on a 240 Hz monitor. That is why Milkdrop draws at 60 by default.
export const MILKDROP_FRAME_RATES = [30, 45, 60, 75, 90, 120, 144];
export const milkdropSettings = [
  {
    id: 'frameRate',
    label: 'settings.milkdrop.frameRate',
    type: 'select',
    default: 60,
    options: [
      ...MILKDROP_FRAME_RATES.map((value) => ({ value, label: () => t(value === 60 ? 'settings.milkdrop.fpsDefault' : 'settings.milkdrop.fps', { value }) })),
      { value: 0, label: 'settings.milkdrop.vsync' },
    ],
  },
  { id: 'blendSeconds', label: 'settings.milkdrop.blend', type: 'range', min: 0, max: 8, step: 0.1, default: 2.7, unit: ' s' },
  {
    id: 'autoAdvanceSeconds',
    label: 'settings.milkdrop.autoAdvance',
    type: 'select',
    default: 0,
    options: [
      { value: 0, label: 'settings.off' },
      { value: 15, label: () => t('settings.milkdrop.every', { seconds: 15 }) },
      { value: 30, label: () => t('settings.milkdrop.every', { seconds: 30 }) },
      { value: 60, label: 'settings.milkdrop.everyMinute' },
    ],
    custom: { label: 'settings.customTime', min: 2, max: 3600, default: 45, unit: ' s' },
  },
  { id: 'dropChange', label: 'settings.milkdrop.dropChange', type: 'toggle', default: true },
  {
    id: 'whenStopped',
    label: 'settings.milkdrop.whenStopped',
    type: 'select',
    default: 'continue',
    options: [
      { value: 'continue', label: 'settings.milkdrop.keepRunning' },
      { value: 'pause', label: 'settings.milkdrop.pause' },
    ],
  },
  waterToggle(false), // Milkdrop fills the whole picture; water is only an option
];

// On a drop the switch should land exactly, so a short cross-fade instead of the normal one.
// While the debug view is open, Milkdrop draws on every pass of the render loop, ignoring its own frame rate.
// Otherwise "FPS" would count passes in which nothing was drawn (tens of thousands with "unlimited").
let measuring = false;
export function setMilkdropMeasuring(on) {
  measuring = Boolean(on);
}

const DROP_BLEND_SECONDS = 0.3;
// With lookahead ("Music" mode) the cross-fade starts earlier and finishes exactly on the drop.
const EARLY_BLEND_SECONDS = { min: 0.1, max: 0.5 };

// The presets are large and are therefore only loaded once capturing is already running.
function loadPresets() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'presets.js';
    script.onload = () => resolve(globalThis.MILKDROP_PRESETS);
    script.onerror = () => reject(new Error(t('milkdrop.presetsFailed')));
    document.head.append(script);
  });
}

// Butterchurn 3 draws into an OffscreenCanvas and then copies every frame into the visible one via a 2D canvas.
// At 4K this copy costs time on every frame. Without OffscreenCanvas, Butterchurn creates a normal canvas
// that we show directly. The copy is then dropped (outputGl = null), as with Butterchurn 2.
// Equations only run as WebAssembly: `new Function` is forbidden in the extension.
function createDirectVisualizer(context, width, height) {
  const offscreen = window.OffscreenCanvas;
  let visualizer;
  try {
    window.OffscreenCanvas = undefined;
    visualizer = butterchurn.createVisualizer(context, document.createElement('canvas'), {
      width,
      height,
      pixelRatio: 1,
      onlyUseWASM: true,
    });
  } finally {
    window.OffscreenCanvas = offscreen;
  }
  visualizer.outputGl = null;
  visualizer.loadExtraImages(imageData);
  return { visualizer, canvas: visualizer.internalCanvas };
}

// Butterchurn compiles shaders without an error message; the picture then simply stays wrong. So check
// after loading ourselves. Only for the given parts, so shaders that were already broken do not count as a new error.
function shaderErrors(visualizer, preset, parts) {
  const errors = [];
  for (const part of SHADER_PARTS.filter(({ id }) => parts.includes(id))) {
    const shader = visualizer.renderer?.[`${part.id}Shader`];
    const gl = shader?.gl;
    const program = shader?.shaderProgram;
    if (!gl || !program || gl.getProgramParameter(program, gl.LINK_STATUS)) continue;
    const fragment = gl.getAttachedShaders(program).find((item) => gl.getShaderParameter(item, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER);
    const log = (fragment && gl.getShaderInfoLog(fragment)) || gl.getProgramInfoLog(program) || t('milkdrop.unknownShaderError');
    const source = fragment ? gl.getShaderSource(fragment) : '';
    for (const error of shaderErrorsFromLog(log, source, preset[part.key] ?? '')) errors.push({ part: part.id, label: part.label, ...error });
  }
  return errors;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Plays presets from the library's active collection in random order.
// `musicStopped()`: true while the music in the tab is paused or stopped (from the media player).
export async function createMilkdrop({ stage, engine, settings, onPresetChange, library, customPresets, musicStopped = () => false }) {
  // Own presets from the presets folder stand next to the bundled ones. With the same name, the own one wins.
  const presets = { ...(await loadPresets()), ...customPresets?.presetMap() };
  const sortNames = (names) => names.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  const allNames = sortNames(Object.keys(presets));
  let order = [];
  let index = 0;
  let poolFallback = false;
  let lastChange = performance.now();
  let drewLastFrame = true;
  const frameGate = createFrameGate();

  // Butterchurn takes the size as output pixels. With CSS pixels plus pixelRatio, part of the canvas would stay
  // empty on scaled screens (4K at 150 %), so always real pixels with pixelRatio 1.
  const { visualizer, canvas } = createDirectVisualizer(
    engine.context,
    Math.round(stage.clientWidth * window.devicePixelRatio),
    Math.round(stage.clientHeight * window.devicePixelRatio),
  );
  stage.append(canvas);
  visualizer.connectAudio(engine.output);

  // Loading is asynchronous (the equations are compiled to WebAssembly). Loads run one after another,
  // so with fast skipping the most recently chosen preset always wins.
  let queue = Promise.resolve();
  const broken = new Set();
  const failedPresets = []; // presets that could not be compiled, with the reason (for tests and debugging)

  // Versions edited in the editor, per preset name. They run instead of the original until they are reset.
  const edits = new Map();
  // Version that ran before the last change. If an edited version breaks while drawing, it goes back there.
  let fallback = null;
  let holdAutoAdvance = false;
  let stoppedSince = null; // since when the picture stands still because the music stopped
  const editErrorListeners = new Set();
  const presetFor = (name) => edits.get(name) ?? presets[name];

  const load = (name, blendSeconds) => {
    lastChange = performance.now();
    onPresetChange?.();
    fallback = null;
    queue = queue
      .then(() => (order[index] === name ? loadFixed(visualizer, presetFor(name), blendSeconds) : undefined))
      .catch((error) => {
        failedPresets.push(`${name}: ${error.message}`);
        console.warn(`Preset "${name}" could not be loaded:`, error);
      });
    return queue;
  };

  // New order when the collection changes. The running preset stays as long as it belongs to it.
  function rebuildOrder() {
    const pool = library ? library.pool(allNames) : { names: allNames, fallback: false };
    poolFallback = pool.fallback;
    const current = order[index];
    order = shuffle([...pool.names]);
    const kept = order.indexOf(current);
    if (kept >= 0) {
      [order[0], order[kept]] = [order[kept], order[0]];
      index = 0;
      return false;
    }
    index = 0;
    return true;
  }

  rebuildOrder();
  await load(order[0], 0);
  library?.onChange(() => {
    if (rebuildOrder()) load(order[0], settings.blendSeconds);
    else onPresetChange?.();
  });

  const step = (delta, blendSeconds = settings.blendSeconds) => {
    for (let tries = 0; tries < order.length; tries++) {
      index = (index + delta + order.length) % order.length;
      if (!broken.has(order[index])) break;
    }
    return load(order[index], blendSeconds);
  };
  // A drop can fall into a frame that is not drawn because of the frame rate. It then waits for the next one.
  let pendingDrop = false;
  // The cross-fade for the upcoming drop is already running; the drop itself then does not switch again.
  let preparedDrop = false;

  return {
    canvas,
    presetNames: allNames,
    get presetName() {
      return order[index];
    },
    // true if the selected collection is empty and therefore all presets play.
    get poolFallback() {
      return poolFallback;
    },
    get failedPresets() {
      return failedPresets;
    },
    // Waits until all started loads are done.
    whenLoaded: () => queue,
    // Show a specific preset. If it does not belong to the collection, it is only inserted.
    selectPreset(name, { blendSeconds = settings.blendSeconds } = {}) {
      if (!presets[name]) return;
      const position = order.indexOf(name);
      if (position >= 0) index = position;
      else {
        order.splice(index + 1, 0, name);
        index += 1;
      }
      return load(name, blendSeconds);
    },
    // Add or replace own presets (after saving or reading the folder).
    // The running preset stays; an edit of the added name is thereby saved and dropped.
    addPresets(map) {
      let added = false;
      for (const [name, preset] of Object.entries(map)) {
        if (presets[name] === preset) continue; // unchanged, a running edit stays
        if (!presets[name]) {
          allNames.push(name);
          added = true;
        }
        presets[name] = preset;
        edits.delete(name);
      }
      if (!added) return;
      sortNames(allNames);
      const current = order[index];
      if (rebuildOrder()) order.unshift(current);
      onPresetChange?.();
    },
    resize(width, height, pixelRatio) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      visualizer.setRendererSize(canvas.width, canvas.height, { pixelRatio: 1 });
    },
    // Whether the last render() really drew. Otherwise the canvas is not new, and the water
    // keeps its previous reflection (a WebGL canvas that was not redrawn reads as empty).
    get drewLastFrame() {
      return drewLastFrame;
    },
    render(frame) {
      const now = performance.now();
      if (frame?.section?.drop) pendingDrop = true;
      // "When the music stops: pause": the picture stands still and goes on from there. Butterchurn counts its
      // time per drawn frame, so nothing jumps afterwards; the automatic change waits for the paused time too.
      if (settings.whenStopped === 'pause' && musicStopped()) {
        if (stoppedSince === null) stoppedSince = now;
        drewLastFrame = false;
        return;
      }
      if (stoppedSince !== null) {
        lastChange += now - stoppedSince;
        stoppedSince = null;
      }
      const pause = frameGate(now, measuring ? 0 : Number(settings.frameRate) || 0);
      drewLastFrame = !pause;
      if (pause) return;
      const interval = settings.autoAdvanceSeconds;
      const dropChange = settings.dropChange && !holdAutoAdvance && order.length > 1;
      const section = frame?.section;
      if (pendingDrop) {
        if (dropChange && !preparedDrop) step(1, DROP_BLEND_SECONDS);
        preparedDrop = false;
      } else if (dropChange && !preparedDrop && section?.dropConfirmed && section.dropIn !== null) {
        step(1, Math.min(EARLY_BLEND_SECONDS.max, Math.max(EARLY_BLEND_SECONDS.min, section.dropIn)));
        preparedDrop = true;
      } else if (preparedDrop && section?.dropIn === null) {
        preparedDrop = false; // lookahead changed, the drop no longer comes
      } else if (!preparedDrop && interval > 0 && !holdAutoAdvance && now - lastChange >= interval * 1000) step(1);
      pendingDrop = false;
      // Single presets break in their equations (WebAssembly errors, for example with int() of huge numbers).
      // An error here would otherwise stop the whole render loop. The preset is skipped and remembered.
      try {
        visualizer.render();
      } catch (error) {
        const name = order[index];
        // An edited version is not skipped: back to the last working one; the editor reports the error.
        if (edits.has(name)) {
          const previous = fallback;
          if (previous) edits.set(name, previous);
          else edits.delete(name);
          fallback = null;
          queue = queue.then(() => loadFixed(visualizer, presetFor(name), 0)).catch(() => {});
          for (const listener of editErrorListeners) listener(error);
          return;
        }
        if (!broken.has(name)) {
          broken.add(name);
          failedPresets.push(`${name}: ${error.message}`);
          console.warn(`Preset "${name}" fails while drawing and is skipped:`, error);
        }
        if (broken.size < order.length) step(1);
      }
    },
    nextPreset: () => step(1),
    previousPreset: () => step(-1),

    // --- For the preset editor ---
    // The running preset as data: original and, if edited, the edited version (copies of each).
    currentPreset() {
      return this.presetData(order[index]);
    },
    // The same for any preset, for example for the second editor window for reference. Unknown: null.
    presetData(name) {
      if (!(name in presets)) return null;
      return {
        name,
        original: structuredClone(presets[name]),
        edited: structuredClone(presetFor(name)),
        isEdited: edits.has(name),
        defaults: {
          base: { ...visualizer.baseValsDefaults },
          shape: { ...visualizer.shapeBaseValsDefaults },
          wave: { ...visualizer.waveBaseValsDefaults },
        },
      };
    },
    // Shows an edited version immediately, without cross-fade. If loading fails, the previous one keeps running.
    async previewPreset(preset) {
      const name = order[index];
      const before = presetFor(name);
      const changedShaders = SHADER_PARTS.filter(({ key }) => (preset[key] ?? '') !== (before[key] ?? '')).map(({ id }) => id);
      const attempt = queue.then(async () => {
        await loadFixed(visualizer, preset, 0);
        const errors = shaderErrors(visualizer, preset, changedShaders);
        if (errors.length) throw Object.assign(new Error(errors[0].message), { shaderErrors: errors });
      });
      queue = attempt.catch(() => {});
      try {
        await attempt;
      } catch (error) {
        await (queue = queue.then(() => loadFixed(visualizer, before, 0)).catch(() => {}));
        throw error;
      }
      fallback = before === presets[name] && !edits.has(name) ? null : before;
      edits.set(name, structuredClone(preset));
      onPresetChange?.();
    },
    // Discards the edit and loads the original.
    resetPreset() {
      const name = order[index];
      edits.delete(name);
      fallback = null;
      onPresetChange?.();
      return (queue = queue.then(() => loadFixed(visualizer, presets[name], 0)).catch(() => {}));
    },
    isEdited: (name) => edits.has(name),
    // Shader errors of the running preset (for debugging and tests).
    shaderErrors: () => shaderErrors(visualizer, presetFor(order[index]), ['warp', 'comp']),
    // Forget the edit of a preset without reloading (another one is running right now).
    dropEdit(name) {
      if (name !== order[index]) edits.delete(name);
    },
    // While the editor is open, the preset does not change by itself.
    // For tests and the debug view: whether the picture stands still because the music stopped.
    get pausedForMusic() {
      return stoppedSince !== null;
    },
    holdAutoAdvance(hold) {
      holdAutoAdvance = hold;
      lastChange = performance.now();
    },
    // Reports runtime errors of an edited version. Returns a function to unsubscribe.
    onEditError(listener) {
      editErrorListeners.add(listener);
      return () => editErrorListeners.delete(listener);
    },
  };
}

// Creates small preview images, one WebP data URL per preset. Runs with whatever sound is currently playing.
// Used by scripts/make-previews.mjs, not in normal operation.
export async function renderPresetPreviews(engine, names, { width = 192, height = 108, frames = 100, maxMillis = 3000, onProgress } = {}) {
  const presets = await loadPresets();
  const { visualizer, canvas } = createDirectVisualizer(engine.context, width, height);
  visualizer.connectAudio(engine.output);
  const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  const result = {};
  for (const [position, name] of names.entries()) {
    if (!presets[name]) continue;
    try {
      await loadFixed(visualizer, presets[name], 0);
    } catch (error) {
      console.warn(`Preview for "${name}" failed:`, error);
      continue;
    }
    // Fix the rendered time: every preset then looks like after a good three seconds, however fast the computer is.
    // Some presets are extremely slow in software rendering. After the time limit the current picture counts.
    const started = performance.now();
    for (let frame = 0; frame < frames && performance.now() - started < maxMillis; frame++) {
      visualizer.render({ elapsedTime: 1 / 30 });
      if (frame % 10 === 0) await nextFrame();
    }
    result[name] = canvas.toDataURL('image/webp', 0.72);
    onProgress?.(position + 1, names.length);
  }
  visualizer.loseGLContext();
  return result;
}

// Loads a preset with repaired shaders (missing texsize_… added, see shader-fix.js).
function loadFixed(visualizer, preset, blendSeconds) {
  return visualizer.loadPreset(withFixedShaders(preset), blendSeconds);
}

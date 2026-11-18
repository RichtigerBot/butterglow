import { AudioEngine, audioSettings } from './audio/engine.js';
import { startDemoSource } from './audio/demo-source.js';
import { createSilenceWatch } from './audio/silence-watch.js';
import { createWater, waterSettings } from './effects/water.js';
import { createDemoController, createPlayer, createTabController, playerSettings } from './player/player.js';
import { createDebugPanel } from './ui/debug-panel.js';
import { createEqualizerPanel } from './ui/equalizer-panel.js';
import { autoSwitchSettingsFor, createAutoSwitch } from './ui/auto-switch.js';
import { createCrossfade, transitionSettings } from './ui/crossfade.js';
import { createCustomPresets } from './milk/custom-presets.js';
import { createCustomStore } from './milk/custom-store.js';
import { createFrameScheduler } from './ui/frame-scheduler.js';
import { createPresetBrowser } from './ui/preset-browser.js';
import { createPresetEditor } from './ui/preset-editor.js';
import { createSidePanels } from './ui/side-panels.js';
import { PresetLibrary } from './ui/preset-library.js';
import { createQuality, qualitySettings } from './ui/quality.js';
import { createSettingsPanel } from './ui/settings-panel.js';
import { renderPresetPreviews, setMilkdropMeasuring } from './visualizers/milkdrop.js';
import { visualizers } from './visualizers/index.js';
import { loadLanguage, onLanguageChange, t, translateDom } from './i18n/i18n.js';

const HUD_IDLE_MS = 3000;
const LIBRARY_KEY = 'presetLibrary';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const status = document.getElementById('status');
const hudTitle = document.getElementById('hud-title');
const hudSubtitle = document.getElementById('hud-subtitle');
const hudBpm = document.getElementById('hud-bpm');
const hudSection = document.getElementById('hud-section');
const sectionLabel = (name) => t(`sections.${name}`);
let dropFlashUntil = 0;
const hudLights = {
  kick: document.getElementById('light-kick'),
  snare: document.getElementById('light-snare'),
  hat: document.getElementById('light-hat'),
};

const engine = new AudioEngine();
const instances = new Map();
let activeIndex = -1;
let active = null;
let switching = false;
let displaySettings = null;
const crossfade = createCrossfade();
const DISPLAY_SCHEMA = [...qualitySettings, ...transitionSettings];
const AUTO_SWITCH_SCHEMA = autoSwitchSettingsFor(visualizers);
let autoSwitch = null;
let equalizer = null;
let settingsPanel = null;
let water = null;
let presetBrowser = null;
let presetEditor = null;
let presetReference = null;
let sidePanels = null;
let player = null;
let library = null;
let customPresets = null;
let quality = null;
let debug = null;
let lastFrame = null;
let waterSettingsLive = null;

// `message`: a function, so the status follows a language switch.
let statusMessage = null;
function showStatus(message, { onClick } = {}) {
  statusMessage = message;
  status.textContent = message();
  status.hidden = false;
  status.disabled = !onClick;
  status.onclick = onClick ?? null;
}

function updateHud() {
  hudTitle.textContent = visualizers[activeIndex]?.name ?? '';
  hudSubtitle.textContent = active?.presetName ?? '';
  hudSubtitle.title = active?.poolFallback ? t('hud.emptyCollection') : '';
  presetBrowser?.update();
  presetEditor?.update();
  presetReference?.update();
}

// The quality level lowers the resolution of all pictures. The window scales them back up to full size.
function resizeActive() {
  const pixelRatio = window.devicePixelRatio * (quality?.scale ?? 1);
  active?.resize(stage.clientWidth, stage.clientHeight, pixelRatio);
  water?.resize(stage.clientWidth, stage.clientHeight, pixelRatio);
}

// `durationMs`: own cross-fade, otherwise the one from Display → Cross-fade.
async function activate(index, { durationMs } = {}) {
  if (switching) return;
  switching = true;
  try {
    const { id, create, settingsSchema = [] } = visualizers[index];
    if (!instances.has(index)) {
      const settings = settingsPanel.settingsFor(id, settingsSchema);
      instances.set(index, await create({ stage, engine, settings, library, customPresets, onPresetChange: updateHud }));
    }
    const previous = active;
    const previousIndex = activeIndex;
    active = instances.get(index);
    active.canvas.hidden = false;
    activeIndex = index;
    // Cross-fade smoothly. If Milkdrop is involved, the water rests meanwhile (see renderFrame).
    const duration = durationMs ?? Number(displaySettings?.transition ?? 0);
    autoSwitch?.noteSwitch(performance.now() / 1000);
    const involvesMilkdrop = [previousIndex, index].some((i) => visualizers[i]?.id === 'milkdrop');
    crossfade.start(previous, active, duration);
    waterPaused = crossfade.running && involvesMilkdrop;
    setWaterFade(waterPaused);
    resizeActive();
    updateHud();
    settingsPanel.showVisualizer(index);
  } catch (error) {
    console.error(error);
    showStatus(() => t('status.visualizerFailed', { name: visualizers[index].name, error: error.message }));
  } finally {
    switching = false;
  }
}

function updateBeatHud(beat, section, now) {
  for (const [band, light] of Object.entries(hudLights)) light.style.opacity = 0.25 + beat[band].pulse * 0.75;
  hudBpm.textContent = beat.bpm === null ? '– BPM' : `${Math.round(beat.bpm)} BPM`;
  const label = sectionLabel(section.name);
  if (hudSection.textContent !== label) hudSection.textContent = label;
  if (hudSection.dataset.section !== section.name) hudSection.dataset.section = section.name;
  hudSection.classList.toggle('dropped', now < dropFlashUntil);
}

// Water during a transition with Milkdrop: hide it briefly and do not compute it, then show it again.
let waterPaused = false;
function setWaterFade(hidden) {
  const canvas = document.getElementById('water');
  if (canvas) canvas.style.opacity = hidden ? '0' : '';
}

function renderFrame(now) {
  const started = performance.now();
  const frame = engine.readFrame();
  lastFrame = frame;
  // Automatic switch. If the visualizer already exists, activate() switches immediately, and the new one draws
  // this very frame, so on a drop with its drop effect.
  const busy = switching || crossfade.running || presetEditor?.open || presetReference?.open || presetBrowser?.open;
  const decision = autoSwitch?.update(frame, now / 1000, { current: activeIndex, busy });
  if (decision) activate(decision.index, { durationMs: decision.durationMs });
  active?.render(frame);
  const wasFading = crossfade.running;
  // The visualizer fading out gets no more drops. Otherwise Milkdrop would still change its preset while fading out.
  const fadingFrame = crossfade.running ? { ...frame, section: { ...frame.section, drop: false, dropIn: null, dropConfirmed: false } } : frame;
  const mixed = crossfade.render(fadingFrame, performance.now(), { needsMix: !waterPaused && Boolean(waterSettingsLive?.enabled) });
  if (wasFading && !crossfade.running && waterPaused) {
    waterPaused = false;
    setWaterFade(false);
  }
  // If the visualizer did not draw this time (Milkdrop at 60 frames/s on a fast monitor), the water keeps its picture.
  if (active && !waterPaused) water?.render(frame, mixed ?? (active.drewLastFrame === false ? null : active.canvas));
  equalizer?.render(frame);
  if (frame.section.drop) dropFlashUntil = now + 250;
  if (!document.body.classList.contains('idle') || settingsPanel?.pinned) updateBeatHud(frame.beat, frame.section, now);
  quality?.frame(now);
  debug?.frame(now, performance.now() - started, frame.beat);
}

// Normally at the monitor's refresh rate. The debug view can set a frame limit, even above the refresh rate.
const scheduler = createFrameScheduler(renderFrame);

const WATER_PRESETS = ['lively', 'ripples', 'classic'];

// Values for the debug view, queried four times per second.
function debugInfo() {
  const { context } = engine;
  const level = quality.level;
  const frame = lastFrame;
  const percent = (value) => String(Math.round((value ?? 0) * 100)).padStart(3);
  const latency = [context.baseLatency, context.outputLatency].map((value) => (value ? `${(value * 1000).toFixed(0)} ms` : '–'));
  return {
    quality: `${quality.auto ? `${t('settings.quality.auto')} → ` : ''}${t(level.label)} (${Math.round(level.scale * 100)} %)`,
    cssWidth: stage.clientWidth,
    cssHeight: stage.clientHeight,
    pixelRatio: window.devicePixelRatio,
    visualizerCanvas: active?.canvas,
    waterCanvas: document.getElementById('water'),
    visualizer: visualizers[activeIndex]?.name ?? '–',
    preset: active?.presetName ?? '',
    water: waterSettingsLive?.enabled ? (WATER_PRESETS.includes(waterSettingsLive.preset) ? t(`settings.water.${waterSettingsLive.preset}`) : waterSettingsLive.preset) : t('debug.off'),
    audio: `${params.has('streamId') ? 'Tab' : 'Demo'} · ${context.state} · ${context.sampleRate} Hz`,
    latency: t('debug.latencyValue', { processing: latency[0], output: latency[1] }),
    levels: frame ? `${percent(frame.bass)} / ${percent(frame.mid)} / ${percent(frame.treble)} %` : '–',
    bpm: frame?.beat.bpm ? `${frame.beat.bpm.toFixed(1)} BPM` : '–',
    section: frame ? sectionInfo(frame.section) : '–',
  };
}

function sectionInfo(section) {
  const since = section.sinceDrop === null ? t('debug.noDrop') : t('debug.lastDrop', { seconds: section.sinceDrop.toFixed(0) });
  const unconfirmed = section.dropConfirmed ? '' : ` ${t('debug.unconfirmed')}`;
  const coming = section.dropIn === null ? '' : ` · ${t('debug.dropIn', { seconds: section.dropIn.toFixed(2) })}${unconfirmed}`;
  const mode = engine.lookahead > 0 ? ` · ${t('debug.lookahead', { seconds: engine.lookahead })}` : '';
  const strength = t('debug.strength', { percent: Math.round(section.intensity * 100) });
  return `${sectionLabel(section.name)} · ${strength} · ${since}${coming}${mode}`;
}

async function toggleFullscreen() {
  const window = await chrome.windows.getCurrent();
  const state = window.state === 'fullscreen' ? 'normal' : 'fullscreen';
  await chrome.windows.update(window.id, { state });
}

const keyActions = {
  v: () => activate((activeIndex + 1) % visualizers.length),
  e: () => equalizer?.toggle(),
  // Browser, editor and reference stand side by side as far as the window allows (side-panels.js).
  b: () => presetBrowser?.toggle(),
  m: () => presetEditor?.toggle(),
  n: () => presetReference?.toggle(),
  ' ': () => player?.toggle(),
  d: () => debug?.toggle(),
  Escape: () => {
    presetBrowser?.close();
    presetEditor?.close();
    presetReference?.close();
  },
  f: toggleFullscreen,
  ArrowRight: () => active?.nextPreset?.(),
  ArrowLeft: () => active?.previousPreset?.(),
};

// Alt alone hides all menus until Alt or Escape shows them again. The mouse does not bring them back.
// Open panels stay open, they are just invisible. Alt together with another key does not count.
let menusHidden = false;
let altAlone = false;
function setMenusHidden(hidden) {
  menusHidden = hidden;
  document.body.classList.toggle('menus-hidden', hidden);
  // Otherwise keys end up in the invisible search field or editor.
  if (hidden && document.activeElement !== document.body) document.activeElement?.blur?.();
}
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Alt') {
      if (!event.repeat) altAlone = true;
      event.preventDefault();
      return;
    }
    altAlone = false;
    if (menusHidden && event.key === 'Escape') {
      // Escape only shows everything again, without closing the panels at the same time.
      event.stopImmediatePropagation();
      event.preventDefault();
      setMenusHidden(false);
    }
  },
  { capture: true },
);
window.addEventListener('keyup', (event) => {
  if (event.key !== 'Alt') return;
  event.preventDefault();
  if (altAlone) setMenusHidden(!menusHidden);
  altAlone = false;
});
window.addEventListener('blur', () => (altAlone = false)); // Alt+Tab: the key release arrives in the other window.

window.addEventListener('keydown', (event) => {
  // Arrow keys on a slider or a select change that and not the preset.
  const isControl = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  if (isControl && event.key.startsWith('Arrow')) return;
  // While typing in a text field (search, name of a collection), letters do not count as shortcuts.
  const isTyping =
    event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLInputElement && ['text', 'search'].includes(event.target.type));
  if (isTyping && event.key !== 'Escape') return;
  // On a button, the space bar already triggers the button itself.
  if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
  if (event.key === ' ') event.preventDefault();
  const action = keyActions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  action();
  updateHud();
  wake();
});

let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (equalizer?.open || presetBrowser?.open || presetEditor?.open || presetReference?.open) return;
  idleTimer = setTimeout(goIdle, HUD_IDLE_MS);
}
// An open dropdown would otherwise be left standing alone when the menu hides. So while a select has
// focus, nothing is hidden. After a selection it gives up focus (see below).
function goIdle() {
  if (document.activeElement?.tagName === 'SELECT') {
    idleTimer = setTimeout(goIdle, HUD_IDLE_MS);
    return;
  }
  document.body.classList.add('idle');
}
for (const type of ['pointermove', 'pointerdown', 'input']) window.addEventListener(type, wake);
window.addEventListener('change', (event) => {
  if (event.target.tagName === 'SELECT') event.target.blur();
  wake();
});

new ResizeObserver(resizeActive).observe(stage);
window.addEventListener('resize', resizeActive); // Also when moving to a monitor with a different scaling.

// The tab is muted while being captured. A suspended AudioContext would mean silence, so ask for a click.
function ensureAudioRunning() {
  if (engine.context.state === 'running') return;
  showStatus(() => t('status.clickToStart'), {
    onClick: async () => {
      await engine.context.resume();
      status.hidden = true;
    },
  });
}

// Copy-protected services (Spotify Web, Netflix, …) deliver silence to the capture. If the tab plays and nothing
// arrives, say so instead of leaving the user in front of 0 %. The hint goes away by itself when sound arrives.
function watchForSilence(controller) {
  let hint = null;
  const watch = createSilenceWatch({
    readPeak: () => engine.inputPeak(),
    readTab: () => controller.send('state'),
    onSilent: (service) => {
      hint = () => (service ? t('status.protectedService', { service }) : t('status.silentTab'));
      showStatus(hint, { onClick: () => (status.hidden = true) });
    },
    onSound: () => {
      if (statusMessage === hint) status.hidden = true;
    },
  });
  setInterval(() => {
    if (engine.context.state === 'running') watch.check(performance.now() / 1000);
  }, 1000);
}

// Language switch at runtime: static texts, the status line and the overlay. The panels listen themselves.
onLanguageChange(() => {
  translateDom();
  if (statusMessage && !status.hidden) status.textContent = statusMessage();
  updateHud();
});

async function start() {
  await loadLanguage();
  translateDom();
  if (params.has('error')) {
    showStatus(() => t('status.cannotCapture', { error: params.get('error') }));
    return;
  }

  try {
    if (params.has('streamId')) {
      await engine.captureTab(params.get('streamId'));
      engine.onStreamEnded(() => showStatus(() => t('status.streamEnded')));
    } else if (params.has('demo')) {
      startDemoSource(engine.context, engine.input, { bpm: Number(params.get('bpm')) || undefined, dense: params.has('dense'), voice: params.get('voice') });
    } else {
      showStatus(() => t('status.startFromIcon'));
      return;
    }
  } catch (error) {
    console.error(error);
    showStatus(() => t('status.captureFailed', { error: error.message }));
    return;
  }

  const { [LIBRARY_KEY]: storedLibrary } = await chrome.storage.local.get(LIBRARY_KEY);
  library = new PresetLibrary(storedLibrary, { save: (data) => chrome.storage.local.set({ [LIBRARY_KEY]: data }) });

  // Own presets from the presets folder. The remembered folder is read without asking; otherwise the list stays empty
  // until a folder is connected in the preset browser or when saving.
  customPresets = createCustomPresets(createCustomStore());
  customPresets.onChange(() => {
    const map = customPresets.presetMap();
    for (const instance of instances.values()) instance.addPresets?.(map);
    library.setOwn(customPresets.names);
    presetBrowser?.refreshFolder();
  });
  // Own presets must never hold up the start: after 3 seconds it continues without them; they arrive later.
  const restoring = customPresets.restore().catch((error) => console.warn('Custom presets not available:', error));
  await Promise.race([restoring, new Promise((done) => setTimeout(done, 3000))]);
  presetBrowser = createPresetBrowser({
    hud: document.getElementById('hud'),
    library,
    customPresets,
    getVisualizer: () => active,
    onChange: () => {
      sidePanels?.layout();
      updateHud();
      wake();
    },
  });
  // The second window for reference is a copy of the editor, made before it builds its tabs.
  const editorRoot = document.getElementById('preset-editor');
  const referenceRoot = editorRoot.cloneNode(true);
  referenceRoot.id = 'preset-reference';
  referenceRoot.dataset.i18nAriaLabel = 'editor.referenceLabel';
  referenceRoot.setAttribute('aria-label', t('editor.referenceLabel'));
  referenceRoot.querySelector('.pe-compare').remove();
  editorRoot.after(referenceRoot);
  const panelChanged = () => {
    sidePanels?.layout();
    wake();
  };
  presetEditor = createPresetEditor({
    root: editorRoot,
    getMilkdrop: () => (active?.currentPreset ? active : null),
    customPresets,
    onChange: panelChanged,
  });
  presetReference = createPresetEditor({
    root: referenceRoot,
    getMilkdrop: () => (active?.currentPreset ? active : null),
    onChange: panelChanged,
    reference: true,
  });
  editorRoot.querySelector('.pe-compare').addEventListener('click', () => presetReference.toggle());
  const panelOf = (element, panel) => ({ element, isOpen: () => panel.open, close: () => panel.close() });
  const browserPanel = panelOf(document.getElementById('preset-browser'), presetBrowser);
  const editorPanel = panelOf(editorRoot, presetEditor);
  const referencePanel = panelOf(referenceRoot, presetReference);
  sidePanels = createSidePanels({ panels: [editorPanel, referencePanel, browserPanel], closeOrder: [browserPanel, referencePanel, editorPanel] });

  settingsPanel = await createSettingsPanel({
    hud: document.getElementById('hud'),
    visualizers,
    sections: [
      { id: 'audio', title: 'settings.sections.audio', schema: audioSettings, onChange: (settings) => engine.applySettings(settings) },
      { id: 'player', title: 'settings.sections.player', schema: playerSettings, onChange: () => player?.applySettings() },
      { id: 'water', title: 'settings.sections.water', schema: waterSettings },
      { id: 'display', title: 'settings.sections.display', schema: DISPLAY_SCHEMA, onChange: () => quality?.applySettings() },
      { id: 'autoSwitch', title: 'settings.sections.autoSwitch', schema: AUTO_SWITCH_SCHEMA },
    ],
    onSelectVisualizer: (index) => activate(index),
    onPinChange: wake,
  });

  engine.applySettings(settingsPanel.settingsFor('audio', audioSettings));
  displaySettings = settingsPanel.settingsFor('display', DISPLAY_SCHEMA);
  autoSwitch = createAutoSwitch({
    visualizers,
    settings: settingsPanel.settingsFor('autoSwitch', AUTO_SWITCH_SCHEMA),
    transitionMs: () => Number(displaySettings.transition ?? 0),
  });
  quality = createQuality({ settings: displaySettings, onScaleChange: resizeActive });
  debug = await createDebugPanel({
    root: document.getElementById('debug'),
    getInfo: debugInfo,
    onLimitChange: (limit, open) => {
      scheduler.setLimit(limit);
      setMilkdropMeasuring(open);
      quality.setTarget(limit);
    },
  });

  // The player controls the captured tab, in demo mode the demo beat.
  const tabId = Number(params.get('tab'));
  const controller = params.has('streamId') && tabId ? createTabController(tabId) : createDemoController(engine.context);
  player = createPlayer({
    root: document.getElementById('player'),
    controller,
    settings: settingsPanel.settingsFor('player', playerSettings),
  });
  if (params.has('streamId')) watchForSilence(controller);

  // The water is a bonus: if WebGL 2 is missing, the rest keeps running without it.
  try {
    waterSettingsLive = settingsPanel.settingsFor('water', waterSettings);
    // "Show water" belongs to each visualizer: Milkdrop starts without water, Neon Ring with it.
    Object.defineProperty(waterSettingsLive, 'enabled', {
      get: () => {
        const { id, settingsSchema = [] } = visualizers[activeIndex] ?? {};
        return id ? Boolean(settingsPanel.settingsFor(id, settingsSchema).water) : false;
      },
    });
    water = createWater({ stage, settings: waterSettingsLive });
    resizeActive();
  } catch (error) {
    console.warn('Water not available:', error);
  }

  equalizer = await createEqualizerPanel({
    root: document.getElementById('equalizer'),
    engine,
    onVisibilityChange: wake,
  });
  document.getElementById('eq-close').addEventListener('click', () => equalizer.toggle());

  ensureAudioRunning();
  wake();
  scheduler.start();
  await activate(0);
}

// Access for the smoke test and for trying things out in DevTools.
globalThis.app = {
  engine,
  visualizers,
  activate,
  keyActions,
  renderPresetPreviews,
  get crossfade() {
    return crossfade;
  },
  get autoSwitch() {
    return autoSwitch;
  },
  get waterPaused() {
    return waterPaused;
  },
  get scheduler() {
    return scheduler;
  },
  get active() {
    return active;
  },
  get library() {
    return library;
  },
  get customPresets() {
    return customPresets;
  },
  get presetBrowser() {
    return presetBrowser;
  },
  get presetEditor() {
    return presetEditor;
  },
  get presetReference() {
    return presetReference;
  },
  get equalizer() {
    return equalizer;
  },
  get player() {
    return player;
  },
  get water() {
    return water;
  },
  get quality() {
    return quality;
  },
  get debug() {
    return debug;
  },
  get menusHidden() {
    return menusHidden;
  },
};

// All modules have loaded once this line runs, so the notice for a failed start is not needed.
document.getElementById('startup-failed')?.remove();
start().catch((error) => {
  console.error(error);
  showStatus(() => t('status.startFailed', { error: error.message }));
});

// Debug view (D key): frame rate, frame times, resolution, graphics card, audio and beats.
// What the values mean is explained in docs/debug.md.
import { onLanguageChange, t } from '../i18n/i18n.js';
import { FRAME_LIMITS, frameLimitLabel } from './frame-scheduler.js';

const STORAGE_KEY = 'debugOpen';
const LIMIT_KEY = 'debugFrameLimit'; // Index in FRAME_LIMITS
const UPDATE_MS = 250; // text and graph four times per second; that costs hardly anything itself
const HISTORY = 180; // frame times for the graph, a little over 3 seconds at 60 frames
const STUTTER_MS = 50; // from here on a single frame is noticeable as a stutter
const STUTTER_SPAN_MS = 10000;
const BEAT_SPAN_MS = 60000;
const GRAPH_MAX_MS = 50;

function gpuName() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return t('debug.noWebgl');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}

const size = (canvas) => (canvas ? `${canvas.width}×${canvas.height}` : '–');
const ms = (value) => `${value.toFixed(1)} ms`;

// `onLimitChange` receives the frame limit and whether the view is open. The limit only applies while it is open,
// so it does not stay active unnoticed.
export async function createDebugPanel({ root, getInfo, onLimitChange }) {
  const table = root.querySelector('.debug-values');
  const limitInput = root.querySelector('.debug-limit input');
  const limitOutput = root.querySelector('.debug-limit output');
  const graph = root.querySelector('.debug-graph');
  const context = graph.getContext('2d');

  const intervals = []; // time between two frames
  const work = []; // own computing time per frame
  const stutters = []; // times of long frames
  const stamps = []; // times of the frames in the last second, for frames/s even at very high rates
  let limitIndex = 0;
  const hits = { kick: [], snare: [], hat: [] };
  let lastTime = null;
  let lastUpdate = 0;
  let gpu = null;
  let open = false;

  // Rows by translation key (debug.rows.*). The names are set again on a language switch.
  const rows = new Map();
  function row(key) {
    if (rows.has(key)) return rows.get(key).value;
    const name = document.createElement('dt');
    name.textContent = t(`debug.rows.${key}`);
    name.dataset.key = key; // for tests, independent of the language
    const value = document.createElement('dd');
    table.append(name, value);
    rows.set(key, { name, value });
    return value;
  }
  onLanguageChange(() => {
    for (const [key, { name }] of rows) name.textContent = t(`debug.rows.${key}`);
    limitOutput.textContent = frameLimitLabel(limit());
    if (open) refresh(performance.now());
  });
  const set = (key, text) => {
    const cell = row(key);
    if (cell.textContent !== text) cell.textContent = text;
  };

  function draw() {
    const { width, height } = graph;
    context.clearRect(0, 0, width, height);
    const y = (value) => height - (Math.min(value, GRAPH_MAX_MS) / GRAPH_MAX_MS) * height;
    // Guide lines: 16.7 ms = 60 frames, 33.3 ms = 30 frames per second.
    context.fillStyle = 'rgb(255 255 255 / 25%)';
    for (const line of [1000 / 60, 1000 / 30]) context.fillRect(0, Math.round(y(line)), width, 1);
    const bar = width / HISTORY;
    const offset = HISTORY - intervals.length;
    intervals.forEach((value, index) => {
      context.fillStyle = value > stutterMs() ? '#ff4f6d' : value > 1000 / 45 ? '#ffc84f' : '#4fd8ff';
      context.fillRect((offset + index) * bar, y(value), Math.max(1, bar - 0.5), height - y(value));
      context.fillStyle = 'rgb(255 255 255 / 70%)';
      const own = work[index];
      context.fillRect((offset + index) * bar, y(own), Math.max(1, bar - 0.5), 1.5);
    });
  }

  const limit = () => FRAME_LIMITS[limitIndex];
  // A stutter is a frame that takes clearly longer than intended. At 15 frames/s, 67 ms is normal.
  const stutterMs = () => (typeof limit() === 'number' ? Math.max(STUTTER_MS, 2000 / limit()) : STUTTER_MS);

  function refresh(now) {
    const info = getInfo();
    const recent = intervals.slice(-60);
    const average = recent.reduce((sum, value) => sum + value, 0) / (recent.length || 1);
    const worst = Math.max(0, ...recent);
    const ownAverage = work.slice(-60).reduce((sum, value) => sum + value, 0) / (Math.min(60, work.length) || 1);

    set('fps', stamps.length > 1 ? String(stamps.length) : '–');
    set('limit', frameLimitLabel(limit()));
    set('frameTime', recent.length ? `${ms(average)} / ${ms(worst)}` : '–');
    set('stutters', String(stutters.length));
    set('ownTime', ms(ownAverage));
    set('quality', info.quality);
    set('window', t('debug.windowValue', { width: info.cssWidth, height: info.cssHeight, scale: info.pixelRatio }));
    set('visualizerImage', size(info.visualizerCanvas));
    set('waterImage', info.waterCanvas && !info.waterCanvas.hidden ? size(info.waterCanvas) : t('debug.off'));
    set('gpu', (gpu ??= gpuName()));
    set('visualizer', info.visualizer);
    set('preset', info.preset || '–');
    set('water', info.water);
    set('audio', info.audio);
    set('latency', info.latency);
    set('levels', info.levels);
    const perMinute = (band) => String(hits[band].length);
    set('hits', `${perMinute('kick')} / ${perMinute('snare')} / ${perMinute('hat')}`);
    set('tempo', info.bpm);
    set('section', info.section);
    set('memory', !performance.memory ? '–' : `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB`);
    draw();
    lastUpdate = now;
  }

  function applyLimit() {
    limitInput.value = String(limitIndex);
    limitOutput.textContent = frameLimitLabel(limit());
    onLimitChange?.(open ? limit() : 'vsync', open);
    intervals.length = 0;
    work.length = 0;
    stutters.length = 0;
    stamps.length = 0;
    lastTime = null;
  }

  limitInput.max = String(FRAME_LIMITS.length - 1);
  limitInput.addEventListener('input', () => {
    limitIndex = Number(limitInput.value);
    applyLimit();
    chrome.storage.local.set({ [LIMIT_KEY]: limitIndex });
  });

  function apply() {
    root.hidden = !open;
    applyLimit();
    if (open) {
      lastTime = null;
      refresh(performance.now());
    }
  }

  const { [STORAGE_KEY]: saved, [LIMIT_KEY]: savedLimit } = await chrome.storage.local.get([STORAGE_KEY, LIMIT_KEY]);
  open = saved === true;
  if (Number.isInteger(savedLimit) && savedLimit >= 0 && savedLimit < FRAME_LIMITS.length) limitIndex = savedLimit;
  apply();

  return {
    get open() {
      return open;
    },
    get limit() {
      return limit();
    },
    toggle() {
      open = !open;
      apply();
      chrome.storage.local.set({ [STORAGE_KEY]: open });
    },
    // For every frame: timestamp from requestAnimationFrame, own computing time and the beat of this frame.
    frame(now, ownMs, beat) {
      for (const band of Object.keys(hits)) {
        if (beat?.[band]?.hit) hits[band].push(now);
        while (hits[band].length && hits[band][0] < now - BEAT_SPAN_MS) hits[band].shift();
      }
      if (!open) return;
      if (lastTime !== null) {
        const interval = now - lastTime;
        intervals.push(interval);
        work.push(ownMs);
        if (intervals.length > HISTORY) {
          intervals.shift();
          work.shift();
        }
        if (interval > stutterMs()) stutters.push(now);
      }
      stamps.push(now);
      while (stamps[0] < now - 1000) stamps.shift();
      while (stutters.length && stutters[0] < now - STUTTER_SPAN_MS) stutters.shift();
      lastTime = now;
      if (now - lastUpdate >= UPDATE_MS) refresh(now);
    },
  };
}

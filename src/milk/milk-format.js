// .milk text ⇄ preset object in Butterchurn's format. Without DOM, so it can be tested in Node.
//
// A .milk file is an INI file with keys such as `fDecay=0.98`. Equations are stored line by line under
// numbered keys (`per_frame_1=…`, `per_frame_2=…`). This way MilkDrop 3 and projectM can read them too.
// Butterchurn only knows GLSL shaders, MilkDrop only HLSL. Our GLSL shaders are therefore stored under their own keys
// (`butterchurn_warp_N`, `butterchurn_comp_N`), which other programs skip. Foreign HLSL shaders are left out
// when reading; the preset then runs with the default shaders.
import { t } from '../i18n/i18n.js';

// Base values: name in the .milk file → name in Butterchurn. Those not listed have the same name in both.
const BASE_KEYS = {
  fRating: 'rating',
  fGammaAdj: 'gammaadj',
  fDecay: 'decay',
  fVideoEchoZoom: 'echo_zoom',
  fVideoEchoAlpha: 'echo_alpha',
  nVideoEchoOrientation: 'echo_orient',
  nWaveMode: 'wave_mode',
  bAdditiveWaves: 'additivewave',
  bWaveDots: 'wave_dots',
  bWaveThick: 'wave_thick',
  bModWaveAlphaByVolume: 'modwavealphabyvolume',
  bMaximizeWaveColor: 'wave_brighten',
  bTexWrap: 'wrap',
  bDarkenCenter: 'darken_center',
  bRedBlueStereo: 'red_blue',
  bBrighten: 'brighten',
  bDarken: 'darken',
  bSolarize: 'solarize',
  bInvert: 'invert',
  bMotionVectorsOn: 'bmotionvectorson',
  fWaveAlpha: 'wave_a',
  fWaveScale: 'wave_scale',
  fWaveSmoothing: 'wave_smoothing',
  fWaveParam: 'wave_mystery',
  fModWaveAlphaStart: 'modwavealphastart',
  fModWaveAlphaEnd: 'modwavealphaend',
  fWarpAnimSpeed: 'warpanimspeed',
  fWarpScale: 'warpscale',
  fZoomExponent: 'zoomexp',
  fShader: 'fshader',
  nMotionVectorsX: 'mv_x',
  nMotionVectorsY: 'mv_y',
};

const SHAPE_KEYS = { thickOutline: 'thickoutline' };
const WAVE_KEYS = { bSpectrum: 'spectrum', bUseDots: 'usedots', bDrawThick: 'thick', bAdditive: 'additive' };

// Equation parts: prefix in the .milk file → key in Butterchurn.
const MAIN_CODE = [
  ['per_frame_init_', 'init_eqs_eel'],
  ['per_frame_', 'frame_eqs_eel'],
  ['per_pixel_', 'pixel_eqs_eel'],
];
const SHAPE_CODE = [
  ['init', 'init_eqs_eel'],
  ['per_frame', 'frame_eqs_eel'],
];
const WAVE_CODE = [
  ['init', 'init_eqs_eel'],
  ['per_frame', 'frame_eqs_eel'],
  ['per_point', 'point_eqs_eel'],
];

const SHAPE_COUNT = 4;
const WAVE_COUNT = 4;
const MILKDROP2_VERSION = 201;

const invert = (map) => Object.fromEntries(Object.entries(map).map(([milk, ours]) => [ours, milk]));
const lowerKeys = (map) => Object.fromEntries(Object.entries(map).map(([milk, ours]) => [milk.toLowerCase(), ours]));
const BASE_TO_MILK = invert(BASE_KEYS);
const SHAPE_TO_MILK = invert(SHAPE_KEYS);
const WAVE_TO_MILK = invert(WAVE_KEYS);
const BASE_FROM_MILK = lowerKeys(BASE_KEYS);
const SHAPE_FROM_MILK = lowerKeys(SHAPE_KEYS);
const WAVE_FROM_MILK = lowerKeys(WAVE_KEYS);

function formatNumber(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function codeLines(key, code) {
  if (!code) return [];
  return code.split('\n').map((line, i) => `${key}${i + 1}=${line}`);
}

// Shader lines in .milk files start with a backtick. This also keeps spaces at the start of a line.
function shaderLines(key, code) {
  if (!code) return [];
  return code.split('\n').map((line, i) => `${key}${i + 1}=\`${line}`);
}

function numberLines(prefix, values, rename) {
  return Object.entries(values ?? {}).map(([key, value]) => `${prefix}${rename[key] ?? key}=${formatNumber(value)}`);
}

// Preset object → .milk text. `basedOn` is the name of the original for edited presets.
export function serializeMilk(preset, { basedOn } = {}) {
  const lines = [];
  if ((preset.version ?? 2) >= 2) lines.push(`MILKDROP_PRESET_VERSION=${MILKDROP2_VERSION}`);
  lines.push('[preset00]');
  if (basedOn) lines.push(`butterchurn_based_on=${basedOn}`);
  lines.push(...numberLines('', preset.baseVals, BASE_TO_MILK));

  (preset.waves ?? []).forEach((wave, i) => {
    lines.push(...numberLines(`wavecode_${i}_`, wave.baseVals, WAVE_TO_MILK));
    for (const [milk, ours] of WAVE_CODE) lines.push(...codeLines(`wave_${i}_${milk}`, wave[ours]));
  });
  (preset.shapes ?? []).forEach((shape, i) => {
    lines.push(...numberLines(`shapecode_${i}_`, shape.baseVals, SHAPE_TO_MILK));
    for (const [milk, ours] of SHAPE_CODE) lines.push(...codeLines(`shape_${i}_${milk}`, shape[ours]));
  });

  for (const [milk, ours] of MAIN_CODE) lines.push(...codeLines(milk, preset[ours]));
  lines.push(...shaderLines('butterchurn_warp_', preset.warp));
  lines.push(...shaderLines('butterchurn_comp_', preset.comp));
  return `${lines.join('\n')}\n`;
}

// Collects numbered lines (`per_frame_1`, `per_frame_2`, …) back into one text. Like MilkDrop, a part ends
// at the first missing number.
function joinNumbered(entries, prefix, { shader = false } = {}) {
  const lines = [];
  for (let n = 1; entries.has(`${prefix}${n}`); n++) {
    const line = entries.get(`${prefix}${n}`);
    lines.push(shader && line.startsWith('`') ? line.slice(1) : line);
  }
  return lines.join('\n');
}

function numberValue(text) {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

// .milk text → { preset, basedOn, warnings }. Unknown keys are skipped.
export function parseMilk(text) {
  const entries = new Map(); // key in lower case → value
  for (const raw of String(text).split(/\r?\n/)) {
    const separator = raw.indexOf('=');
    if (separator <= 0 || raw.startsWith('[')) continue;
    entries.set(raw.slice(0, separator).trim().toLowerCase(), raw.slice(separator + 1));
  }

  const warnings = [];
  const version = (numberValue(entries.get('milkdrop_preset_version')) ?? 0) >= 200 ? 2 : 1;
  const preset = { version, baseVals: {}, shapes: [], waves: [] };

  const shapePattern = /^shapecode_(\d)_(.+)$/;
  const wavePattern = /^wavecode_(\d)_(.+)$/;
  for (let i = 0; i < SHAPE_COUNT; i++) preset.shapes.push({ baseVals: {} });
  for (let i = 0; i < WAVE_COUNT; i++) preset.waves.push({ baseVals: {} });

  for (const [key, raw] of entries) {
    let match;
    if ((match = shapePattern.exec(key))) {
      const value = numberValue(raw);
      const shape = preset.shapes[Number(match[1])];
      if (shape && value !== null) shape.baseVals[SHAPE_FROM_MILK[match[2]] ?? match[2]] = value;
    } else if ((match = wavePattern.exec(key))) {
      const value = numberValue(raw);
      const wave = preset.waves[Number(match[1])];
      if (wave && value !== null) wave.baseVals[WAVE_FROM_MILK[match[2]] ?? match[2]] = value;
    } else if (/^[a-z][a-z0-9_]*$/.test(key) && !/_\d+$|\d$/.test(key) && !key.startsWith('butterchurn_') && key !== 'milkdrop_preset_version' && !key.startsWith('psversion')) {
      const value = numberValue(raw);
      if (value !== null) preset.baseVals[BASE_FROM_MILK[key] ?? key] = value;
    }
  }

  preset.shapes.forEach((shape, i) => {
    for (const [milk, ours] of SHAPE_CODE) shape[ours] = joinNumbered(entries, `shape_${i}_${milk}`);
  });
  preset.waves.forEach((wave, i) => {
    for (const [milk, ours] of WAVE_CODE) wave[ours] = joinNumbered(entries, `wave_${i}_${milk}`);
  });
  for (const [milk, ours] of MAIN_CODE) preset[ours] = joinNumbered(entries, milk);

  preset.warp = joinNumbered(entries, 'butterchurn_warp_', { shader: true });
  preset.comp = joinNumbered(entries, 'butterchurn_comp_', { shader: true });
  if (!preset.warp && entries.has('warp_1')) warnings.push(t('format.hlslWarp'));
  if (!preset.comp && entries.has('comp_1')) warnings.push(t('format.hlslComp'));

  return { preset, basedOn: entries.get('butterchurn_based_on') || null, warnings };
}

// File name for a preset. Characters that file systems do not like are replaced.
export function fileNameFor(name) {
  return `${String(name).replace(/[\\/:*?"<>|]/g, '_').trim()}.milk`;
}

export function nameFromFile(fileName) {
  return fileName.replace(/\.milk$/i, '');
}

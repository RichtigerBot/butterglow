// A Milkdrop preset as data: base values (baseVals) and equations in Milkdrop notation (`*_eqs_eel`).
// Without DOM and without Butterchurn, so it can be tested in Node.
import { t } from '../i18n/i18n.js';

// `label` and `hint` are read in the current language (model.parts.* and model.hints.*).
function part(id, key, group) {
  return {
    id,
    key,
    get label() {
      return t(`model.parts.${id}`);
    },
    get hint() {
      return t(`model.hints.${group}.${id}`);
    },
  };
}

// The equation parts of the whole preset.
export const CODE_PARTS = [part('init', 'init_eqs_eel', 'preset'), part('frame', 'frame_eqs_eel', 'preset'), part('pixel', 'pixel_eqs_eel', 'preset')];

// Shapes (up to 4): filled polygons with their own equations.
export const SHAPE_CODE = [part('init', 'init_eqs_eel', 'shape'), part('frame', 'frame_eqs_eel', 'shape')];

// Waves (up to 4): lines or dots from the sound data.
export const WAVE_CODE = [part('init', 'init_eqs_eel', 'wave'), part('frame', 'frame_eqs_eel', 'wave'), part('point', 'point_eqs_eel', 'wave')];

// Shaders in GLSL, as Butterchurn runs them.
export const SHADER_PARTS = [part('warp', 'warp', 'shader'), part('comp', 'comp', 'shader')];

export const SHAPE_COUNT = 4;
export const WAVE_COUNT = 4;

// All equation slots of a preset with a unique id, such as 'frame', 'shape2-frame' or 'wave0-point'.
export function codeSlots(preset) {
  const slots = CODE_PARTS.map((part) => ({ id: part.id, label: part.label, code: preset[part.key] ?? '' }));
  (preset.shapes ?? []).forEach((shape, i) => {
    for (const part of SHAPE_CODE) slots.push({ id: `shape${i}-${part.id}`, label: t('model.shapePart', { number: i + 1, part: part.label }), code: shape[part.key] ?? '' });
  });
  (preset.waves ?? []).forEach((wave, i) => {
    for (const part of WAVE_CODE) slots.push({ id: `wave${i}-${part.id}`, label: t('model.wavePart', { number: i + 1, part: part.label }), code: wave[part.key] ?? '' });
  });
  return slots;
}

export function clonePreset(preset) {
  return structuredClone(preset);
}

// Number from an input field. Comma and dot are both allowed. Anything invalid gives null.
export function parseNumber(text) {
  const normalized = String(text).trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// New preset from a base preset and changes: { baseVals: { zoom: 1.02 }, code: { frame: '...' } }.
// The base preset stays unchanged.
export function withChanges(base, { baseVals = {}, code = {} } = {}) {
  const preset = clonePreset(base);
  preset.baseVals = { ...preset.baseVals, ...baseVals };
  for (const part of CODE_PARTS) {
    if (part.id in code) preset[part.key] = code[part.id];
  }
  return preset;
}

function valuesDiffer(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].some((key) => a[key] !== b[key]);
}

// Do two presets differ in what the editor can edit?
export function differs(a, b) {
  if ([...CODE_PARTS, ...SHADER_PARTS].some(({ key }) => (a[key] ?? '') !== (b[key] ?? ''))) return true;
  if (valuesDiffer(a.baseVals, b.baseVals)) return true;
  const items = (preset, kind, i) => preset[kind]?.[i] ?? {};
  for (const [kind, parts, count] of [['shapes', SHAPE_CODE, SHAPE_COUNT], ['waves', WAVE_CODE, WAVE_COUNT]]) {
    for (let i = 0; i < count; i++) {
      const x = items(a, kind, i);
      const y = items(b, kind, i);
      if (valuesDiffer(x.baseVals, y.baseVals)) return true;
      if (parts.some(({ key }) => (x[key] ?? '') !== (y[key] ?? ''))) return true;
    }
  }
  return false;
}

// Values for the display: all that Butterchurn knows (`defaults`), plus those that are set.
// `changed` means: differs from the default. `rating` is only a rating and not a picture parameter.
export function editableValues(values = {}, defaults = {}) {
  const keys = new Set([...Object.keys(defaults), ...Object.keys(values)]);
  keys.delete('rating');
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = values[key] ?? defaults[key];
      return { key, value, changed: key in defaults ? value !== defaults[key] : true };
    });
}

export function editableBaseVals(preset, defaults = {}) {
  return editableValues(preset.baseVals, defaults);
}

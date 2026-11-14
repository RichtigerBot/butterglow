import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileNameFor, nameFromFile, parseMilk, serializeMilk } from '../src/milk/milk-format.js';
import { setLanguageForTest } from '../src/i18n/i18n.js';

setLanguageForTest('en');

const dir = new URL('../node_modules/butterchurn-presets/presets/converted/', import.meta.url);
const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
const load = async (file) => JSON.parse(await readFile(new URL(encodeURIComponent(file), dir), 'utf8'));

// Butterchurn presets do not always have all parts. Missing equations are empty.
function normalize(preset) {
  const code = (part, keys) => Object.fromEntries(keys.map((key) => [key, part[key] ?? '']));
  return {
    version: preset.version,
    baseVals: preset.baseVals,
    ...code(preset, ['init_eqs_eel', 'frame_eqs_eel', 'pixel_eqs_eel', 'warp', 'comp']),
    shapes: preset.shapes.map((shape) => ({ baseVals: shape.baseVals, ...code(shape, ['init_eqs_eel', 'frame_eqs_eel']) })),
    waves: preset.waves.map((wave) => ({ baseVals: wave.baseVals, ...code(wave, ['init_eqs_eel', 'frame_eqs_eel', 'point_eqs_eel']) })),
  };
}

test('All bundled presets survive the round trip to .milk and back', async () => {
  const failed = [];
  for (const file of files) {
    const preset = await load(file);
    const { preset: back, warnings } = parseMilk(serializeMilk(preset));
    try {
      assert.deepEqual(normalize(back), normalize(preset));
      assert.deepEqual(warnings, []);
    } catch {
      failed.push(file);
    }
  }
  assert.deepEqual(failed.slice(0, 5), [], `${failed.length} Presets weichen ab`);
});

test('The .milk file uses the MilkDrop names', async () => {
  const text = serializeMilk(await load('Waltra - Square Orgy.json'), { basedOn: 'Waltra - Square Orgy' });
  assert.match(text, /^MILKDROP_PRESET_VERSION=201\n\[preset00\]\n/);
  assert.match(text, /\nbutterchurn_based_on=Waltra - Square Orgy\n/);
  assert.match(text, /\nfGammaAdj=1\.78\n/);
  assert.match(text, /\nbWaveDots=1\n/);
  assert.match(text, /\nshapecode_0_sides=100\n/);
  assert.match(text, /\nper_frame_1=dec_med = pow \(0\.8, 30\/fps\);\n/);
  assert.match(text, /\nbutterchurn_comp_1=`/);
  assert.equal(parseMilk(text).basedOn, 'Waltra - Square Orgy');
});

test('A file from MilkDrop: case does not matter, HLSL shaders skipped with a warning', () => {
  const text = [
    'MILKDROP_PRESET_VERSION=201',
    'PSVERSION=2',
    '[preset00]',
    'fDecay=0.900000',
    'ZOOM=1.010000',
    'nMotionVectorsX=24.000000',
    'wavecode_1_bSpectrum=1',
    'shapecode_2_thickOutline=1',
    'shape_2_per_frame1=x = 0.5 + 0.1*bass;',
    'per_frame_1=zoom = zoom + 0.1*bass;',
    'per_frame_2=  rot = 0.01;',
    'per_frame_4=is not read because 3 is missing',
    'warp_1=`shader_body {',
    'warp_2=`}',
    '',
  ].join('\r\n');
  const { preset, warnings } = parseMilk(text);
  assert.equal(preset.version, 2);
  assert.equal(preset.baseVals.decay, 0.9);
  assert.equal(preset.baseVals.zoom, 1.01);
  assert.equal(preset.baseVals.mv_x, 24);
  assert.equal(preset.waves[1].baseVals.spectrum, 1);
  assert.equal(preset.shapes[2].baseVals.thickoutline, 1);
  assert.equal(preset.shapes[2].frame_eqs_eel, 'x = 0.5 + 0.1*bass;');
  assert.equal(preset.frame_eqs_eel, 'zoom = zoom + 0.1*bass;\n  rot = 0.01;');
  assert.equal(preset.warp, '');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /warp shader is HLSL/);
});

test('File names without forbidden characters', () => {
  assert.equal(fileNameFor('Geiss - A/B: Test? (bearbeitet)'), 'Geiss - A_B_ Test_ (bearbeitet).milk');
  assert.equal(nameFromFile('Waltra - Square Orgy (bearbeitet).milk'), 'Waltra - Square Orgy (bearbeitet)');
});

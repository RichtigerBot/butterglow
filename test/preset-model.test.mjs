import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguageForTest } from '../src/i18n/i18n.js';
import { checkCode, checkPreset } from '../src/milk/preset-check.js';
import { differs, editableBaseVals, parseNumber, withChanges } from '../src/milk/preset-model.js';

setLanguageForTest('en');

const preset = {
  version: 2,
  baseVals: { rating: 5, zoom: 1.01, decay: 0.98 },
  init_eqs_eel: 'step = 0;',
  frame_eqs_eel: 'zoom = zoom + 0.1*bass;\nrot = rot + 0.01;',
  pixel_eqs_eel: '',
  shapes: [],
  waves: [],
};

test('Numbers with comma or dot; nonsense gives null', () => {
  assert.equal(parseNumber('0,5'), 0.5);
  assert.equal(parseNumber(' -1.25 '), -1.25);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('1e-3'), 0.001);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('1.2.3'), null);
});

test('Changes create a new preset; the old one stays', () => {
  const changed = withChanges(preset, { baseVals: { zoom: 1.2 }, code: { frame: 'zoom = 2;' } });
  assert.equal(changed.baseVals.zoom, 1.2);
  assert.equal(changed.baseVals.decay, 0.98);
  assert.equal(changed.frame_eqs_eel, 'zoom = 2;');
  assert.equal(changed.init_eqs_eel, 'step = 0;');
  assert.equal(preset.baseVals.zoom, 1.01);
  assert.ok(differs(preset, changed));
  assert.ok(!differs(preset, withChanges(preset)));
});

test('Base values sorted, with defaults, without rating', () => {
  const rows = editableBaseVals(preset, { zoom: 1, decay: 0.98, warp: 1 });
  assert.deepEqual(rows.map(({ key }) => key), ['decay', 'warp', 'zoom']);
  assert.deepEqual(rows.map(({ changed }) => changed), [false, false, true]);
  assert.equal(rows[1].value, 1);
});

test('Valid equations have no errors', () => {
  assert.equal(checkCode(preset.frame_eqs_eel), null);
  assert.equal(checkCode(''), null);
  assert.deepEqual(checkPreset(preset), []);
});

test('Errors name part, line and an understandable message', () => {
  const broken = withChanges(preset, { code: { frame: 'zoom = 1;\nrot = rot + * 2;', pixel: 'x = foo(1);' } });
  const errors = checkPreset(broken);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].part, 'frame');
  assert.equal(errors[0].line, 2);
  assert.match(errors[0].message, /“\*” does not fit here/);
  assert.equal(errors[1].part, 'pixel');
  assert.equal(errors[1].message, 'Unknown function “foo”');
});

test('Error messages are also available in German', () => {
  const broken = withChanges(preset, { code: { frame: 'zoom = 1;\nrot = rot + * 2;', pixel: 'x = foo(1);' } });
  setLanguageForTest('de');
  try {
    const errors = checkPreset(broken);
    assert.match(errors[0].message, /passt „\*“ nicht hin/);
    assert.equal(errors[1].message, 'Unbekannte Funktion „foo“');
  } finally {
    setLanguageForTest('en');
  }
});

test('All bundled presets pass the check', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../node_modules/butterchurn-presets/presets/converted/', import.meta.url);
  const failed = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.json'))) {
    const errors = checkPreset(JSON.parse(await readFile(new URL(encodeURIComponent(file), dir), 'utf8')));
    if (errors.length) failed.push(`${file}: ${errors[0].detail}`);
  }
  assert.deepEqual(failed, []);
});

test('Equations of shapes and waves are checked too', async () => {
  const { withChanges: change } = await import('../src/milk/preset-model.js');
  const broken = change(preset);
  broken.shapes = [{ baseVals: {}, init_eqs_eel: '', frame_eqs_eel: 'x = 0.5;\nrad = + ;' }];
  broken.waves = [{ baseVals: {}, init_eqs_eel: '', frame_eqs_eel: '', point_eqs_eel: 'y = sin(;' }];
  const errors = checkPreset(broken);
  assert.deepEqual(errors.map(({ part, label, line }) => [part, label, line]), [
    ['shape0-frame', 'Shape 1 · Frame', 2],
    ['wave0-point', 'Wave 1 · Point', 1],
  ]);
});

test('Shader errors show the line in the own text', async () => {
  const { shaderErrorsFromLog, explainShaderError } = await import('../src/milk/preset-check.js');
  const text = 'vec3 colour(float t) {\n  return vec3(t);\n}\nshader_body {\n  ret = colour(time);\n  ret += foo;\n}';
  // This is how Butterchurn puts the shader into its frame: head before main, body in main.
  const header = text.slice(0, text.indexOf('shader_body'));
  const body = text.slice(text.indexOf('{', text.indexOf('shader_body')) + 1, text.lastIndexOf('}'));
  const source = `#version 300 es\nprecision highp float;\nuniform float time;\n      ${header}\n\nvoid main(void) {\n  vec3 ret;\n        ${body}\n  fragColor = vec4(ret, 1.0);\n}`;
  const bodyStart = source.slice(0, source.indexOf(body)).split('\n').length;
  const fooLine = bodyStart + 2; // "ret += foo;" is the third line of the body (the first is the rest after "{")
  const log = `ERROR: 0:${fooLine}: 'foo' : undeclared identifier\nERROR: 0:${fooLine}: '+=' : wrong operand types\n`;
  const errors = shaderErrorsFromLog(log, source, text);
  assert.equal(errors[0].line, 6);
  assert.equal(errors[0].message, 'Unknown name “foo”');
  assert.match(errors[1].message, /do not fit together/);
  const headerLine = source.slice(0, source.indexOf(header)).split('\n').length + 1;
  assert.equal(shaderErrorsFromLog(`ERROR: 0:${headerLine}: 'vec3' : syntax error`, source, text)[0].line, 2);
  assert.equal(explainShaderError('something new'), 'something new');
});

test('Templates are complete and free of errors', async () => {
  const { TEMPLATES } = await import('../src/milk/templates.js');
  const { parseMilk, serializeMilk } = await import('../src/milk/milk-format.js');
  assert.ok(TEMPLATES.length >= 4);
  for (const template of TEMPLATES) {
    const made = template.preset();
    assert.equal(made.shapes.length, 4, template.id);
    assert.equal(made.waves.length, 4, template.id);
    assert.deepEqual(checkPreset(made), [], template.id);
    assert.notEqual(template.preset(), made, 'a new copy every time');
    assert.equal(parseMilk(serializeMilk(made)).preset.frame_eqs_eel, made.frame_eqs_eel, template.id);
  }
});

test('Syntax colouring keeps every character and recognises the kinds', async () => {
  const { highlight } = await import('../src/milk/highlight.js');
  const code = 'zoom = 1 + 0.05*bass; // comment <b>\nq1 = sin(time) & x;';
  const html = highlight(code);
  const text = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(text, `${code}\n`);
  assert.match(html, /<span class="tk-variable">zoom<\/span>/);
  assert.match(html, /<span class="tk-number">0\.05<\/span>/);
  assert.match(html, /<span class="tk-comment">\/\/ comment &lt;b&gt;<\/span>/);
  assert.match(html, /<span class="tk-bridge">q1<\/span>/);
  assert.match(html, /<span class="tk-function">sin<\/span>/);
  const glsl = highlight('shader_body {\n  vec3 a = texture(sampler_main, uv).rgb;\n}', 'glsl');
  assert.match(glsl, /<span class="tk-keyword">vec3<\/span>/);
  assert.match(glsl, /<span class="tk-function">texture<\/span>/);
});

test('Missing texsize_ are added, line numbers stay', async () => {
  const { fixShaderText, withFixedShaders } = await import('../src/milk/shader-fix.js');
  const text = 'uniform sampler2D sampler_nebula;\n shader_body {\n  ret = texture(sampler_nebula, uv * texsize_nebula.zw).xyz + texsize_noise_lq.x;\n}';
  const fixed = fixShaderText(text);
  assert.match(fixed, /^const vec4 texsize_nebula = vec4\(256\.0/);
  assert.doesNotMatch(fixed, /vec4 texsize_noise_lq/);
  assert.equal(fixed.split('\n').length, text.split('\n').length);
  assert.equal(fixShaderText('shader_body { ret = vec3(0.0); }'), 'shader_body { ret = vec3(0.0); }');
  const own = 'const vec4 texsize_x = vec4(1.0);\nshader_body { ret = texsize_x.xyz; }';
  assert.equal(fixShaderText(own), own);
  const preset = { warp: '', comp: 'shader_body { ret = vec3(0.0); }' };
  assert.equal(withFixedShaders(preset), preset);
});

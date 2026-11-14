// Checks a preset's equations before it is loaded. This way it can tell in which part and on which
// line an error is. Butterchurn itself only reports that loading failed.
import { compileModule } from 'eel-wasm';
import { t } from '../i18n/i18n.js';
import { codeSlots } from './preset-model.js';

// Translates eel-wasm messages into understandable text. The original is kept as `detail`.
export function explainError(message) {
  const unknown = message.match(/^"(.+)" is not defined/);
  if (unknown) return t('check.unknownFunction', { name: unknown[1] });
  const parse = message.match(/^Parse Error: .*got '(.+)'$/s);
  if (parse) {
    const known = { EOF: 'check.endOfEquation', DIGITS_TOKEN: 'check.number', IDENTIFIER_TOKEN: 'check.name' }[parse[1]];
    const token = known ? t(known) : t('check.quoted', { text: parse[1] });
    return t('check.unexpected', { token });
  }
  if (/^Lexical error/i.test(message)) return t('check.unknownCharacter');
  return message;
}

// Checks a single equation. Returns null or { line, column, message, detail }.
export function checkCode(code, { version = 2 } = {}) {
  if (!code || !code.trim()) return null;
  try {
    compileModule({ pools: { check: new Set() }, functions: { check: { pool: 'check', code } }, eelVersion: version });
    return null;
  } catch (error) {
    return {
      line: error.loc?.first_line ?? null,
      column: error.loc?.first_column ?? null,
      message: explainError(error.message),
      detail: error.message,
    };
  }
}

// Checks all equations: preset, shapes and waves. Returns a list; empty means no errors.
// `part` is the id from codeSlots, such as 'frame' or 'shape2-frame'.
export function checkPreset(preset) {
  const errors = [];
  for (const slot of codeSlots(preset)) {
    const error = checkCode(slot.code, { version: preset.version ?? 2 });
    if (error) errors.push({ part: slot.id, label: slot.label, ...error });
  }
  return errors;
}

// Translates common GLSL messages. Unknown ones stay in the original.
export function explainShaderError(message) {
  const rules = [
    [/'(.+)' : undeclared identifier/, (m) => t('check.shader.undeclared', { name: m[1] })],
    [/'(.+)' : no matching overloaded function found/, (m) => t('check.shader.noOverload', { name: m[1] })],
    [/'(.+)' : syntax error/, (m) => t('check.shader.syntaxAt', { text: m[1] })],
    [/syntax error/, () => t('check.shader.syntax')],
    [/dimension mismatch|cannot convert|wrong operand types/, () => t('check.shader.mismatch')],
    [/'(.+)' : redefinition/, (m) => t('check.shader.redefinition', { name: m[1] })],
  ];
  for (const [pattern, text] of rules) {
    const match = message.match(pattern);
    if (match) return text(match);
  }
  return message;
}

// Butterchurn splits a shader at "shader_body" into a head (functions, variables) and a body (between the
// curly braces) and puts both into a fixed frame. Like ShaderUtils.getShaderParts in Butterchurn.
function shaderParts(text) {
  const start = text.indexOf('shader_body');
  if (!text || start < 0) return { header: '', body: text, bodyLine: 1 };
  const after = text.slice(start);
  const open = after.indexOf('{');
  const body = after.slice(open + 1, after.lastIndexOf('}'));
  return { header: text.slice(0, start), body, bodyLine: text.slice(0, start + open).split('\n').length };
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// WebGL error log → errors with line numbers in the text you see in the editor.
// `source` is the whole compiled shader with its frame, `text` the shader from the preset.
export function shaderErrorsFromLog(log, source, text) {
  const { header, body, bodyLine } = shaderParts(text);
  const ranges = [];
  if (header.trim()) {
    const at = source.indexOf(header);
    if (at >= 0) ranges.push({ from: lineAt(source, at), count: header.split('\n').length, userLine: 1 });
  }
  const bodyInSource = body.replace(/texture2D/g, 'texture').replace(/texture3D/g, 'texture');
  const at = bodyInSource.trim() ? source.indexOf(bodyInSource) : -1;
  if (at >= 0) ranges.push({ from: lineAt(source, at), count: body.split('\n').length, userLine: bodyLine });

  const errors = [];
  for (const match of log.matchAll(/ERROR:\s*\d+:(\d+):\s*(.+)/g)) {
    const sourceLine = Number(match[1]);
    const range = ranges.find(({ from, count }) => sourceLine >= from && sourceLine < from + count);
    errors.push({
      line: range ? range.userLine + sourceLine - range.from : null,
      message: explainShaderError(match[2].trim()),
      detail: match[2].trim(),
    });
  }
  if (errors.length === 0 && log.trim()) errors.push({ line: null, message: log.trim(), detail: log.trim() });
  return errors;
}

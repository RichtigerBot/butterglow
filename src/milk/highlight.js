// Syntax colouring for equations (EEL) and shaders (GLSL). Returns HTML with <span class="tk-…">, without DOM.
// The editor puts the result under a transparent text field. So every character must appear exactly once.
import { EEL_FUNCTION_NAMES, EEL_VARIABLE_NAMES } from './variables.js';

const GLSL_KEYWORDS = new Set(
  'float int bool vec2 vec3 vec4 ivec2 ivec3 mat2 mat3 mat4 sampler2D sampler3D uniform const in out inout if else for while return void break continue discard true false shader_body'.split(' '),
);
const GLSL_FUNCTIONS = new Set(
  'texture texture2D texture3D mix clamp fract smoothstep step length dot cross normalize distance reflect sin cos tan asin acos atan pow exp exp2 log log2 sqrt inversesqrt abs sign floor ceil mod min max lum GetMain GetPixel GetBlur1 GetBlur2 GetBlur3'.split(
    ' ',
  ),
);
const GLSL_VARIABLES = new Set(
  'ret uv uv_orig rad ang time fps frame bass mid treb vol bass_att mid_att treb_att vol_att texsize aspect decay hue_shader rand_frame rand_preset roam_cos roam_sin slow_roam_cos slow_roam_sin scale1 scale2 scale3 bias1 bias2 bias3 sampler_main sampler_blur1 sampler_blur2 sampler_blur3 sampler_noise_lq sampler_noise_mq sampler_noise_hq sampler_noise_lq_lite sampler_noisevol_lq sampler_noisevol_hq resolution'.split(
    ' ',
  ),
);

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const span = (kind, text) => `<span class="tk-${kind}">${escape(text)}</span>`;

// `language`: 'eel' for equations, 'glsl' for shaders.
export function highlight(text, language = 'eel') {
  const glsl = language === 'glsl';
  let html = '';
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text))) {
    const [token, comment, number, name] = match;
    if (comment) html += span('comment', token);
    else if (number) html += span('number', token);
    else if (name) {
      const lower = glsl ? name : name.toLowerCase();
      const calls = /^\s*\(/.test(text.slice(TOKEN.lastIndex));
      if (/^(q([1-9]|[12]\d|3[0-2])|t[1-8])$/.test(lower)) html += span('bridge', token);
      else if (glsl && GLSL_KEYWORDS.has(name)) html += span('keyword', token);
      else if (calls && (glsl ? GLSL_FUNCTIONS.has(name) : EEL_FUNCTION_NAMES.has(lower))) html += span('function', token);
      else if (glsl ? GLSL_VARIABLES.has(name) : EEL_VARIABLE_NAMES.has(lower)) html += span('variable', token);
      else html += escape(token);
    } else html += escape(token);
  }
  // An empty line at the end, so the coloured layer is as high as the text field after a line break.
  return `${html}\n`;
}

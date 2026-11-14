// "Lively" preset: like "Ripples", but with higher waves, a swell in time with the bass and rings
// that run all the way to the horizon. What gets too fine for single pixels there does not vanish but glitters.
// The rings are computed exactly per screen pixel from the wave table, so there is no grid.
import { bakeWaveTable, GRAVITY, LIVELY_SPLASHES, LIVELY_TABLE, WaveField } from './water-waves.js';

const { radii: TABLE_RADII, times: TABLE_TIMES, maxRho: MAX_RHO, maxTau: MAX_TAU } = LIVELY_TABLE;
const SWELL_BY_BASS = 2.4; // How strongly the swell follows the bass
const SWELL_SMOOTHING_SECONDS = 0.35;

const MAX_FIELD_WIDTH = 1920; // The waves are soft enough; the reflection still stays at full resolution.
const FOCAL = 0.5; // In picture heights. Gives rings that appear about five times wider than high.
const SOURCE_DEPTH = 0.45; // Point below the visualizer, as a share of the water strip from the waterline

const PROJECTION = `
uniform float level;
uniform float aspect;
const float FOCAL = ${FOCAL.toFixed(3)};
// Camera one unit above the water. t is the distance below the waterline in picture heights.
vec2 worldAt(vec2 screen, out float t) {
  t = max(level - screen.y, 1e-4);
  return vec2((screen.x - 0.5) * aspect / t, FOCAL / t);
}`;

const FIELD_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec4 event; // x, z, size, height
layout(location = 1) in float tau;
uniform float level;
uniform float aspect;
uniform float sourceZ;
const float FOCAL = ${FOCAL.toFixed(3)};
const float MAX_RHO = ${MAX_RHO.toFixed(1)};
out vec2 screen;
flat out vec4 vEvent;
flat out float vTau;
void main() {
  // Only draw the rectangle the ring can have reached so far. That saves most of the work.
  float radius = event.z * min(MAX_RHO, tau * 1.1 + 12.0);
  float z = sourceZ + event.y;
  float nearZ = max(z - radius, 0.05);
  float farZ = z + radius;
  float halfWidth = (abs(event.x) + radius) / nearZ / aspect;
  vec2 corner = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
  float top = level - FOCAL / farZ;
  float bottom = level - FOCAL / nearZ;
  screen = vec2(0.5 + (corner.x * 2.0 - 1.0) * (halfWidth + 0.002), mix(bottom, top, corner.y));
  vEvent = vec4(event.x, z, event[2], event[3]);
  vTau = tau;
  gl_Position = vec4(screen * 2.0 - 1.0, 0.0, 1.0);
}`;

const FIELD_FRAGMENT = `#version 300 es
precision highp float;
in vec2 screen;
flat in vec4 vEvent;
flat in float vTau;
out vec4 color;
uniform sampler2D waves;
uniform vec2 pixel;
const float MAX_RHO = ${MAX_RHO.toFixed(1)};
const float MAX_TAU = ${MAX_TAU.toFixed(1)};
${PROJECTION}
void main() {
  float t;
  vec2 world = worldAt(screen, t);
  vec2 offset = world - vEvent.xy;
  float distance = length(offset);
  float size = vEvent.z;
  float rho = distance / size;
  if (rho >= MAX_RHO) discard;

  vec2 entry = texture(waves, vec2(rho / MAX_RHO, vTau / MAX_TAU)).rg;
  float fade = smoothstep(1.0, 0.8, vTau / MAX_TAU) * smoothstep(1.0, 0.92, rho / MAX_RHO);

  // Waves that appear shorter than a few pixels would flicker. What matters is the pixel size in the direction of travel:
  // rings running sideways stay sharp up to the horizon, towards the viewer they quickly get too fine.
  vec2 direction = offset / max(distance, 1e-4);
  float footprint = abs(direction.x) * aspect / t * pixel.x + abs(direction.y) * FOCAL / (t * t) * pixel.y;
  float resolved = smoothstep(1.5, 4.0, 6.283 * size / footprint);

  float height = entry.r * vEvent.w * fade;
  float slope = entry.g * vEvent.w * fade / size;
  // The rest is not thrown away: it makes the surface rough and lets it glitter, like real water in the distance.
  color = vec4(height * resolved, slope * resolved * direction, abs(slope) * (1.0 - resolved));
}`;

const SURFACE_VERTEX = `#version 300 es
out vec2 screen;
void main() {
  screen = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(screen * 2.0 - 1.0, 0.0, 1.0);
}`;

const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 screen;
out vec4 color;
uniform sampler2D field;
uniform sampler2D scene;
uniform float reflection;
uniform float time;
uniform float sourceZ;
uniform vec2 pixel;
uniform float maxLod;
uniform float swell;
uniform float strength;
const float GRAVITY = ${GRAVITY.toFixed(1)};
${PROJECTION}

// Wind and swell over the whole surface up to the horizon. The long waves rise with the bass.
// Here too ω² = g·k. What is too fine for the pixels ends up in rough and becomes glitter.
vec2 wind(vec2 world, float t, out float rough) {
  vec2 slope = vec2(0.0);
  rough = 0.0;
  const vec4 waves[8] = vec4[8](
    vec4(0.96, 0.28, 0.45, 1.0), vec4(-0.6, 0.8, 0.7, 1.0), vec4(0.8, 0.6, 1.1, 1.0),
    vec4(0.8, 0.6, 2.6, 0.0), vec4(-0.5, 0.87, 4.3, 0.0), vec4(0.97, -0.26, 7.1, 0.0), vec4(-0.71, -0.71, 11.0, 0.0),
    vec4(0.28, 0.96, 17.0, 0.0)
  );
  for (int i = 0; i < 8; i++) {
    float k = waves[i].z;
    vec2 direction = waves[i].xy;
    float footprint = abs(direction.x) * aspect / t * pixel.x + abs(direction.y) * FOCAL / (t * t) * pixel.y;
    float visible = smoothstep(1.5, 4.0, 6.283 / k / footprint);
    float amplitude = waves[i].w > 0.5 ? (0.006 + swell * 0.05) : 0.006;
    amplitude *= strength;
    float phase = dot(direction, world) * k - sqrt(GRAVITY * k) * time * 0.5 + float(i) * 1.7;
    slope += direction * cos(phase) * amplitude * visible;
    rough += amplitude * (1.0 - visible);
  }
  return slope;
}

void main() {
  float t;
  vec2 world = worldAt(screen, t);
  float edge = smoothstep(-pixel.y, pixel.y, level - screen.y);
  if (edge <= 0.0) {
    color = vec4(0.0);
    return;
  }

  vec4 sampled = texture(field, screen);
  float windRough;
  vec2 slope = sampled.gb + wind(world, t, windRough);
  float sparkle = clamp(sampled.a * 1.5 + windRough * 6.0, 0.0, 1.0);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 toEye = normalize(vec3(-world.x, 1.0, -world.y));
  float facing = max(dot(toEye, normal), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

  // Reflection: on smooth water exactly the picture above the waterline, pixel by pixel. Slope deflects the ray,
  // and because you look at the water at a flat angle, slope towards the viewer acts much more strongly than sideways.
  float mirrorY = level + t + slope.y * 0.32;
  float mirrorX = screen.x + slope.x * 0.16;
  vec2 mirrorUv = vec2(mirrorX, clamp(mirrorY, level, 1.0));
  float roughness = clamp(length(slope) * 2.2 + sparkle * 0.7, 0.0, 1.0);
  vec3 sharp = textureLod(scene, mirrorUv, 0.0).rgb;
  vec3 soft = textureLod(scene, mirrorUv, 1.0 + roughness * 3.0).rgb;
  vec3 mirrored = mix(sharp, soft, roughness * 0.6);

  // The visualizer is the light source: slopes facing it catch its colour, even where the reflection is black.
  vec3 light = textureLod(scene, vec2(0.5, (level + 1.0) * 0.5), maxLod - 2.0).rgb;
  float reach = clamp(length(sampled.gb) * 1.2, 0.0, 0.4);
  vec3 wide = textureLod(scene, vec2(screen.x + slope.x * 0.5, level + t + reach), maxLod - 3.0).rgb;
  vec3 lightPosition = vec3(0.0, 0.7, sourceZ);
  vec3 toLight = normalize(lightPosition - vec3(world.x, 0.0, world.y));
  vec3 halfway = normalize(toEye + toLight);
  float gloss = pow(max(dot(normal, halfway), 0.0), 40.0);
  float flatGloss = pow(max(halfway.y, 0.0), 40.0);
  float glint = max(gloss - flatGloss, 0.0) * 6.0;
  // Distant waves that are too fine: some of the facets randomly face the light. That gives the typical sparkle.
  float facets = fract(sin(dot(floor(screen / pixel * 0.5), vec2(12.9898, 78.233)) + floor(time * 12.0) * 7.31) * 43758.5453);
  float distanceBand = smoothstep(level * 0.01, level * 0.08, t) * (1.0 - smoothstep(level * 0.15, level * 0.7, t));
  glint += sparkle * smoothstep(0.965, 1.0, facets) * 0.5 * distanceBand;

  float mirrorStrength = reflection * (0.55 + 0.45 * sqrt(fresnel));
  vec3 water = vec3(0.004, 0.008, 0.016) + light * 0.015;
  water += mirrored * mirrorStrength;
  water += wide * roughness * 1.8 * reflection;
  water += (light * 3.0 + 0.04) * glint;

  // Towards the horizon the water fades into haze, which keeps the line soft.
  float haze = exp(-t / max(level * 0.035, 1e-3));
  water = mix(water, mirrored * reflection + light * 0.1, haze * 0.6);

  color = vec4(water * edge, edge);
}`;

function buildProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function createTexture(gl, minFilter) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function createLivelyWater(gl, settings) {
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float rendering is not available.');

  const fieldPass = buildProgram(gl, FIELD_VERTEX, FIELD_FRAGMENT);
  const surfacePass = buildProgram(gl, SURFACE_VERTEX, SURFACE_FRAGMENT);
  const waves = new WaveField({ splashes: LIVELY_SPLASHES });
  let swell = 0;

  const waveTexture = createTexture(gl, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, TABLE_RADII, TABLE_TIMES, 0, gl.RG, gl.FLOAT, bakeWaveTable(LIVELY_TABLE));

  const sceneTexture = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR);

  const fieldTexture = createTexture(gl, gl.LINEAR);
  const framebuffer = gl.createFramebuffer();
  let fieldWidth = 0;
  let fieldHeight = 0;

  const instanceBuffer = gl.createBuffer();
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  gl.vertexAttribDivisor(1, 1);
  const emptyArray = gl.createVertexArray();
  gl.bindVertexArray(emptyArray);

  function ensureField(canvas) {
    const scale = Math.min(1, MAX_FIELD_WIDTH / canvas.width);
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    if (width === fieldWidth && height === fieldHeight) return;
    fieldWidth = width;
    fieldHeight = height;
    gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTexture, 0);
  }

  let sceneLod = 8;
  function uploadScene(source) {
    if (!source?.width || !source.height) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    sceneLod = Math.floor(Math.log2(Math.max(source.width, source.height)));
  }

  function shared(uniforms, sourceZ) {
    gl.uniform1f(uniforms.level, settings.level / 100);
    gl.uniform1f(uniforms.aspect, gl.canvas.width / gl.canvas.height);
    gl.uniform1f(uniforms.sourceZ, sourceZ);
  }

  return {
    waves,
    fieldSize: () => [fieldWidth, fieldHeight],
    // For tests: reads height and slope at a picture position (0 to 1, bottom 0).
    readField(x, y) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      const pixel = new Float32Array(4);
      gl.readPixels(Math.floor(x * fieldWidth), Math.floor(y * fieldHeight), 1, 1, gl.RGBA, gl.FLOAT, pixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { height: pixel[0], slopeX: pixel[1], slopeZ: pixel[2] };
    },
    render(deltaSeconds, { beat, section, bass = 0 }, source) {
      const { canvas } = gl;
      const level = settings.level / 100;
      const sourceZ = FOCAL / (level * SOURCE_DEPTH);
      const strength = (settings.strength ?? 100) / 100;
      waves.update(deltaSeconds, beat, { waves: (settings.waves / 100) * strength, vibration: (settings.vibration / 100) * strength }, settings.dropSplash === false ? null : section);
      const swellTarget = Math.min(1, bass * SWELL_BY_BASS) * (settings.waves / 100);
      swell += (swellTarget - swell) * (1 - Math.exp(-deltaSeconds / SWELL_SMOOTHING_SECONDS));
      ensureField(canvas);
      uploadScene(source);

      // 1. Add up all running rings: water waves simply superimpose.
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, fieldWidth, fieldHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const count = waves.writeInstances();
      if (count > 0) {
        gl.useProgram(fieldPass.program);
        shared(fieldPass.uniforms, sourceZ);
        gl.uniform1i(fieldPass.uniforms.waves, 0);
        gl.uniform2f(fieldPass.uniforms.pixel, 1 / fieldWidth, 1 / fieldHeight);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, waveTexture);
        gl.bindVertexArray(vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, waves.instances.subarray(0, count * 5), gl.DYNAMIC_DRAW);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.scissor(0, 0, fieldWidth, Math.ceil(fieldHeight * level));
        gl.enable(gl.SCISSOR_TEST);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);
      }

      // 2. Draw the water surface at full resolution.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindVertexArray(emptyArray);
      gl.useProgram(surfacePass.program);
      shared(surfacePass.uniforms, sourceZ);
      gl.uniform1i(surfacePass.uniforms.field, 0);
      gl.uniform1i(surfacePass.uniforms.scene, 1);
      gl.uniform1f(surfacePass.uniforms.reflection, settings.reflection / 100);
      gl.uniform1f(surfacePass.uniforms.time, waves.time);
      gl.uniform1f(surfacePass.uniforms.maxLod, sceneLod);
      gl.uniform1f(surfacePass.uniforms.swell, swell);
      gl.uniform1f(surfacePass.uniforms.strength, strength);
      gl.uniform2f(surfacePass.uniforms.pixel, 1 / canvas.width, 1 / canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

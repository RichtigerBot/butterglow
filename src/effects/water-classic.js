// "Classic" preset: water seen from the side with a surface line, as if through a pane of glass.
import { WaterSurface } from './water-surface.js';

export const CLASSIC_MAX_RENDER_WIDTH = 1920; // This preset does not need to be sharper even at 4K.

const SCENE_WIDTH = 384;
const SCENE_HEIGHT = 216;
const WAVE_SCREEN_HEIGHT = 0.07; // Height 1 of the simulation as a share of the picture height

const VERTEX_SHADER = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D heights;
uniform sampler2D scene;
uniform float level;
uniform float waveHeight;
uniform float reflection;
uniform float time;
uniform float snare;
uniform float hat;
uniform float kick;
uniform vec2 pixel;

float surfaceAt(float x) {
  return level + texture(heights, vec2(x, 0.5)).r * waveHeight;
}

void main() {
  float surface = surfaceAt(uv.x);
  float depth = surface - uv.y;
  float edge = smoothstep(-pixel.y, pixel.y, depth);
  if (edge <= 0.0) {
    color = vec4(0.0);
    return;
  }

  // The reflection only follows the large waves. With the fine vibration it would break up into vertical stripes.
  float slope = (surfaceAt(uv.x + 0.012) - surfaceAt(uv.x - 0.012)) / 0.024;
  float smoothSurface = (surfaceAt(uv.x - 0.012) + surfaceAt(uv.x + 0.012)) * 0.5;
  float relativeDepth = clamp(depth / max(surface, 0.001), 0.0, 1.0);

  // The vibration also runs through the water, getting weaker with depth.
  float vibration = sin(depth * 190.0 - time * 21.0 + uv.x * 40.0) * snare * 0.012
    + sin(depth * 520.0 + time * 46.0 - uv.x * 150.0) * hat * 0.005;
  vibration *= 1.0 - relativeDepth * 0.7;

  vec2 mirrored = vec2(
    uv.x + clamp(slope, -0.6, 0.6) * depth * 0.18 + vibration,
    smoothSurface + (smoothSurface - uv.y) * 1.3 + vibration * 0.6
  );
  vec3 reflected = texture(scene, clamp(mirrored, 0.0, 1.0)).rgb;

  // The base colour comes from the picture itself, so the water matches every visualizer.
  vec3 ambient = textureLod(scene, vec2(uv.x, 0.6), 5.0).rgb;
  vec3 deep = mix(vec3(0.012, 0.02, 0.055), ambient * 0.5, 0.65);
  vec3 water = mix(reflected, deep, 1.0 - reflection * (1.0 - relativeDepth * 0.75));
  water *= 1.0 - relativeDepth * 0.55;

  // Bright edge at the surface that lights up on the kick, plus shine on steep spots.
  float rim = exp(-depth / (pixel.y * 3.0));
  water += (ambient * 1.4 + vec3(0.12, 0.16, 0.22)) * rim * (0.45 + kick * 0.55);
  water += ambient * clamp(abs(slope) * 0.18, 0.0, 0.5) * (1.0 - relativeDepth);

  color = vec4(water * edge, edge);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export function createClassicWater(gl, settings) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

  const uniform = Object.fromEntries(
    ['heights', 'scene', 'level', 'waveHeight', 'reflection', 'time', 'snare', 'hat', 'kick', 'pixel'].map((name) => [
      name,
      gl.getUniformLocation(program, name),
    ]),
  );

  const texture = () => {
    const created = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, created);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return created;
  };
  const surface = new WaterSurface();
  const heightsTexture = texture();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  const sceneTexture = texture();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

  // Scaled-down copy of the picture. That saves computing time and is enough for the reflection.
  const sceneCanvas = document.createElement('canvas');
  sceneCanvas.width = SCENE_WIDTH;
  sceneCanvas.height = SCENE_HEIGHT;
  const sceneContext = sceneCanvas.getContext('2d', { alpha: false });

  return {
    surface,
    render(deltaSeconds, { beat, section }, source) {
      const { canvas } = gl;
      gl.useProgram(program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1i(uniform.heights, 0);
      gl.uniform1i(uniform.scene, 1);

      const strength = (settings.strength ?? 100) / 100;
      const heights = surface.update(deltaSeconds, beat, {
        waves: (settings.waves / 100) * strength,
        vibration: (settings.vibration / 100) * strength,
        drop: settings.dropSplash === false ? null : section,
      });

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, heightsTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, heights.length, 1, 0, gl.RED, gl.FLOAT, heights);

      if (source?.width && source.height) sceneContext.drawImage(source, 0, 0, SCENE_WIDTH, SCENE_HEIGHT);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.uniform1f(uniform.level, settings.level / 100);
      gl.uniform1f(uniform.waveHeight, WAVE_SCREEN_HEIGHT);
      gl.uniform1f(uniform.reflection, settings.reflection / 100);
      gl.uniform1f(uniform.time, surface.time);
      gl.uniform1f(uniform.snare, surface.snare * (settings.vibration / 100) * strength);
      gl.uniform1f(uniform.hat, surface.hat * (settings.vibration / 100) * strength);
      gl.uniform1f(uniform.kick, beat.kick.pulse);
      gl.uniform2f(uniform.pixel, 1 / canvas.width, 1 / canvas.height);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

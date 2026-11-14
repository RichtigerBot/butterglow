// Small repairs to shaders before Butterchurn compiles them.
//
// For every image texture `sampler_name`, MilkDrop also knows `texsize_name` (width, height, 1/width, 1/height).
// Butterchurn binds its own image textures (missing ones are replaced by a cloud texture) but does not define
// `texsize_name`. Shaders that use it then fail to compile, and the picture stays black.
// Here the missing value is added as a constant. The size of the images is unknown; 256 is the usual one.

// These already exist in Butterchurn.
const BUILT_IN = new Set(['noise_lq', 'noise_lq_lite', 'noise_mq', 'noise_hq', 'noisevol_lq', 'noisevol_hq']);
const DEFAULT_SIZE = 256;

export function fixShaderText(text) {
  if (!text || !text.includes('texsize_')) return text;
  const missing = new Set();
  for (const [, name] of text.matchAll(/\btexsize_(\w+)/g)) {
    if (BUILT_IN.has(name)) continue;
    // Already defined by the shader itself? Then do nothing.
    if (new RegExp(`\\b(?:vec4|float4)\\s+texsize_${name}\\b`).test(text)) continue;
    missing.add(name);
  }
  if (missing.size === 0) return text;
  const size = `${DEFAULT_SIZE}.0`;
  const lines = [...missing].map((name) => `const vec4 texsize_${name} = vec4(${size}, ${size}, 1.0 / ${size}, 1.0 / ${size});`);
  // Put it at the front of the first line, i.e. into the head before shader_body. This keeps line numbers for error messages.
  return `${lines.join(' ')} ${text}`;
}

// Copy of the preset with repaired shaders. Without changes it stays the same object.
export function withFixedShaders(preset) {
  if (!preset) return preset;
  const warp = fixShaderText(preset.warp);
  const comp = fixShaderText(preset.comp);
  if (warp === preset.warp && comp === preset.comp) return preset;
  return { ...preset, warp, comp };
}

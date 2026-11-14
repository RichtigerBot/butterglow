// Builds the extension into dist/. Load this folder in Chrome as an unpacked extension.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const PRESET_DIR = join(dirname(require.resolve('butterchurn-presets/package.json')), 'presets/converted');

// These presets break while drawing in Butterchurn 3 ("float unrepresentable in integer range"):
// their equations convert huge numbers into integers, and WebAssembly traps on that.
// The visualizer would skip them, but they should not appear in the browser in the first place.
const BROKEN_PRESETS = new Set([
  'Rovastar & Loadus + Zylot - FractalDrop (Spark Machine v2.0)',
  'Flexi + Martin - astral projection',
  // Shaders already mistranslated in butterchurn-presets (variables without declaration); the picture is wrong.
  'amandio c - fume',
  'flexi - can′t think of mosaic cages',
  'lit claw (explorers grid) - i don′t have either a belfry or bats bitch',
  'martin - adrift on a dead planet - lard mix',
  'martin - adrift on a dead planet - lite',
  'martin - alien grand theft water',
  'martin - dune racer',
  'martin - elusive impressions mix1',
  'martin - organic light',
  'martin + stahlregen - martin in da mash 16',
]);

// Butterchurn 3 compiles the equations to WebAssembly itself. The presets are therefore pure data,
// with the original equations from the .milk file (`*_eqs_eel`) and the shaders in GLSL.
async function buildPresets() {
  const files = (await readdir(PRESET_DIR)).filter((file) => file.endsWith('.json')).sort();
  const presets = {};
  for (const file of files) {
    const name = file.slice(0, -'.json'.length);
    if (!BROKEN_PRESETS.has(name)) presets[name] = JSON.parse(await readFile(join(PRESET_DIR, file), 'utf8'));
  }
  console.log(`${Object.keys(presets).length} Milkdrop presets`);
  return `// Generated from butterchurn-presets (MIT license).\nglobalThis.MILKDROP_PRESETS=${JSON.stringify(presets)};\n`;
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist');

await esbuild.build({
  entryPoints: ['src/background.js', 'src/visualizer.js'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: 'chrome124',
  logLevel: 'warning',
});

for (const file of ['manifest.json', '_locales', 'visualizer.html', 'visualizer.css', 'icons']) {
  await cp(`src/${file}`, `dist/${file}`, { recursive: true });
}
await writeFile('dist/presets.js', await buildPresets());

// Licenses belong in every distributed copy (MIT requires the license texts to be included).
for (const file of ['LICENSE', 'THIRD-PARTY-LICENSES.txt']) await cp(file, `dist/${file}`);

// Preview images are optional: without them the browser shows gradients (create them with `npm run previews`).
await cp('src/previews.json', 'dist/previews.json').catch(() => console.log('No preview images, see npm run previews'));

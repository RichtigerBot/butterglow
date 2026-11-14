// Creates the small preview images of the Milkdrop presets in src/previews.json.
// Renders every preset in an invisible Chrome with the demo beat. No sound reaches the speakers.
// Existing images are kept; an interrupted run continues there on the next start.
// Usage: npm run previews   (needs Chrome, see test/smoke-test.mjs; FRESH=1 renders everything again)
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BATCH = 10;
const OUTPUT = 'src/previews.json';
const extensionPath = resolve(process.env.EXTENSION_DIR ?? 'dist'); // a separate folder is possible, so a new build does not interfere
const extensionId = [...createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

const previews = process.env.FRESH ? {} : await readFile(OUTPUT, 'utf8').then(JSON.parse).catch(() => ({}));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  protocolTimeout: 900000,
  ignoreDefaultArgs: ['--disable-extensions', '--mute-audio'],
  args: [
    '--no-sandbox',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--disable-audio-output', // No sound from the speakers; the analysis still gets it.
    '--autoplay-policy=no-user-gesture-required',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(900000);
  await page.setViewport({ width: 640, height: 360 });
  await page.goto(`chrome-extension://${extensionId}/visualizer.html?demo=1`);
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 60000 });
  await new Promise((done) => setTimeout(done, 2000));
  const names = await page.evaluate(() => app.active.presetNames);
  // Images of presets that no longer exist are dropped.
  for (const name of Object.keys(previews)) if (!names.includes(name)) delete previews[name];
  const missing = names.filter((name) => !previews[name]);
  console.log(`${names.length - missing.length} present, ${missing.length} missing`);
  for (let start = 0; start < missing.length; start += BATCH) {
    const batch = missing.slice(start, start + BATCH);
    Object.assign(previews, await page.evaluate((list) => app.renderPresetPreviews(app.engine, list), batch));
    await writeFile(OUTPUT, JSON.stringify(previews));
    console.log(`${Math.min(start + BATCH, missing.length)} / ${missing.length}`);
  }
  const size = JSON.stringify(previews).length;
  console.log(`${Object.keys(previews).length} preview images, ${(size / 1024 / 1024).toFixed(1)} MB`);
} finally {
  await browser.close();
}

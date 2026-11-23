// Loads dist/ in a real Chrome. Tests demo mode, all presets and tab capture.
// The Chrome path comes from CHROME_PATH or the Puppeteer cache.
import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const extensionPath = resolve('dist');
const cache = join(homedir(), '.cache/puppeteer');
const executablePath = process.env.CHROME_PATH ?? join(cache, globSync('chrome/*/*/chrome', { cwd: cache })[0]);

// This is how Chrome derives the ID of an unpacked extension from its path.
const extensionId = [...createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

mkdirSync('test-output', { recursive: true });

const failures = [];
function check(name, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  if (!passed) failures.push(name);
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    `--allowlisted-extension-id=${extensionId}`,
    '--disable-audio-output', // Audio keeps running internally but never reaches the speakers.
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  // Otherwise Puppeteer mutes tabs, and capture would only receive silence.
  ignoreDefaultArgs: ['--disable-extensions', '--mute-audio', '--hide-scrollbars'], // scrollbars as in a real browser
});

try {
  // The connection keeps the service worker awake during the long preset run.
  const worker = await (await browser.waitForTarget((target) => target.type() === 'service_worker')).worker();
  const baseUrl = `chrome-extension://${extensionId}/visualizer.html`;
  // Software rendering is slow. "Automatic" would lower the resolution, but the checks need full size.
  // The checks below compare English texts; a separate check switches to German.
  await worker.evaluate(() => chrome.storage.local.set({ language: 'en', hud: { values: { display: { quality: 'high' } } } }));

  // Demo mode with the real security rules of an extension page.
  const page = await browser.newPage();
  const errors = collectErrors(page);
  await page.setViewport({ width: 800, height: 450 });
  await page.goto(`${baseUrl}?demo=1`);
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  check('The notice for a failed start is removed', await page.evaluate(() => !document.getElementById('startup-failed')));

  // Without a user click Chrome suspends audio; the page then has to ask for a click.
  const blocked = await page.evaluate(() => app.engine.context.state !== 'running');
  if (blocked) {
    check('Page asks for a click to start audio', await page.$eval('#status', (status) => !status.hidden));
    await page.click('#status');
  }
  await sleep(1000);
  check('Audio is running', await page.evaluate(() => app.engine.context.state === 'running'), blocked ? '(after click)' : '(without click)');

  const levels = await page.evaluate(() => app.engine.readFrame().bass);
  check('Demo beat reaches the analysis', levels > 0, `Bass ${levels.toFixed(2)}`);

  // A drop as the section detector reports it: Milkdrop switches the preset and the display flashes.
  const section = await page.evaluate(() => {
    const { name, drop } = app.engine.readFrame().section;
    return { name, drop, label: document.getElementById('hud-section').textContent };
  });
  check('Section reaches the visualizers', ['quiet', 'build', 'drop', 'normal'].includes(section.name) && section.drop === false, JSON.stringify(section));
  const dropped = await page.evaluate(async () => {
    const before = app.active.presetName;
    app.engine.pendingDrop = 1;
    let flashed = false;
    for (let i = 0; i < 20 && app.active.presetName === before; i++) {
      await new Promise(requestAnimationFrame);
      flashed ||= document.getElementById('hud-section').classList.contains('dropped');
    }
    return { before, after: app.active.presetName, flashed };
  });
  check('On a drop Milkdrop switches the preset and the display flashes', dropped.before !== dropped.after && dropped.flashed, JSON.stringify(dropped));

  // "Audio" menu: own volume and "Music" mode. Audio is then delayed; an announced drop makes Milkdrop
  // crossfade beforehand and lands exactly when it becomes audible.
  const lookahead = await page.evaluate(async () => {
    const { engine } = app;
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const volume = document.querySelector('#hud-shared-settings [data-setting="audio.volume"] input');
    const mode = [...document.querySelectorAll('#hud-shared-settings select')].find((select) => [...select.options].some((option) => option.value === '0.5'));
    volume.value = '50';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    mode.value = '0.5';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(700);
    const result = { gain: engine.volume.gain.value, delay: engine.delay.delayTime.value, lookahead: engine.lookahead };
    const before = app.active.presetName;
    const at = engine.context.currentTime + 0.5;
    engine.upcomingDrop = { at, confirmed: true, strength: 1 };
    const hud = document.getElementById('hud-section');
    while (engine.context.currentTime < at + 0.5 && result.flashedAt === undefined) {
      await new Promise(requestAnimationFrame);
      if (result.changedAt === undefined && app.active.presetName !== before) result.changedAt = engine.context.currentTime - at;
      if (hud.classList.contains('dropped')) result.flashedAt = engine.context.currentTime - at;
    }
    volume.value = '100';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    mode.value = '0';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(200);
    result.delayAfter = engine.delay.delayTime.value;
    return result;
  });
  check('Volume slider controls the audible output', Math.abs(lookahead.gain - 0.25) < 0.02, JSON.stringify({ gain: lookahead.gain }));
  check('"Music" mode delays audio by 0.5 s, "Instant" does not', lookahead.delay === 0.5 && lookahead.lookahead === 0.5 && lookahead.delayAfter === 0, JSON.stringify(lookahead));
  check(
    'With lookahead Milkdrop crossfades before the drop, and the drop lands on time',
    lookahead.changedAt < 0 && lookahead.flashedAt >= -0.02 && lookahead.flashedAt < 0.15,
    JSON.stringify({ changedAt: lookahead.changedAt, flashedAt: lookahead.flashedAt }),
  );

  // "Auto" menu: the visualizer switches on a drop, then back to Milkdrop and auto-switch off.
  const autoSwitched = await page.evaluate(async () => {
    const choose = (element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const title = () => document.getElementById('hud-title').textContent;
    const mode = document.querySelector('#hud-shared-settings [data-setting="autoSwitch.mode"] select');
    choose(mode, 'drop');
    const before = title();
    app.autoSwitch.noteSwitch(performance.now() / 1000 - 100); // as if the last switch was long ago
    app.engine.pendingDrop = 1;
    for (let i = 0; i < 30 && title() === before; i++) await new Promise(requestAnimationFrame);
    const after = title();
    choose(mode, 'off');
    await app.activate(0);
    while (app.crossfade.running) await new Promise(requestAnimationFrame);
    return { before, after, back: title() };
  });
  check(
    'Auto-switch changes the visualizer on a drop',
    autoSwitched.before === 'Milkdrop' && autoSwitched.after === 'Neon Ring' && autoSwitched.back === 'Milkdrop',
    JSON.stringify(autoSwitched),
  );

  // Language: the menu switches to German at once, without a reload, and the choice survives a new window.
  const texts = () => ({
    lang: document.documentElement.lang,
    volume: document.querySelector('#hud-shared-settings [data-setting="audio.volume"]').firstChild.textContent,
    browserKey: document.querySelector('[data-i18n="keys.browser"]').textContent,
    neonOption: document.querySelector('#hud-visualizer option[value="1"]')?.textContent,
    audioRunning: app.engine.context.state === 'running',
  });
  const switchTo = (language) => {
    const select = document.getElementById('hud-language');
    select.value = language;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const german = await page.evaluate(`(${switchTo})('de'); (${texts})()`);
  await sleep(200); // the choice is written to storage asynchronously
  const storedLanguage = await worker.evaluate(() => chrome.storage.local.get('language').then((stored) => stored.language));
  const germanPage = await browser.newPage();
  await germanPage.goto(`${baseUrl}?demo=1`);
  await germanPage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  const germanAfterStart = await germanPage.evaluate(texts);
  await germanPage.close();
  const english = await page.evaluate(`(${switchTo})('en'); (${texts})()`);
  check(
    'Language switch shows German at once, keeps it in a new window, and switches back',
    german.lang === 'de' && german.volume === 'Lautstärke' && german.browserKey === 'Auswahl' && german.neonOption === 'Neon-Ring' && german.audioRunning &&
      storedLanguage === 'de' && germanAfterStart.lang === 'de' && germanAfterStart.volume === 'Lautstärke' &&
      english.lang === 'en' && english.volume === 'Volume' && english.browserKey === 'Browser' && english.neonOption === 'Neon Ring',
    JSON.stringify({ german, storedLanguage, germanAfterStart, english }),
  );

  // Load and render every preset. Equation errors would show up here as exceptions.
  const presetResult = await page.evaluate(async () => {
    const instance = await app.visualizers[0].create({
      stage: document.getElementById('stage'),
      engine: app.engine,
      settings: { blendSeconds: 0, autoAdvanceSeconds: 0 },
    });
    const failed = [];
    const names = Object.keys(globalThis.MILKDROP_PRESETS);
    for (const _ of names) {
      try {
        await instance.nextPreset();
        instance.render();
        // A shader that fails to compile throws nothing; the image just stays wrong or black.
        const shader = instance.shaderErrors()[0];
        if (shader) failed.push(`${instance.presetName}: ${shader.part} line ${shader.line}: ${shader.detail}`);
      } catch (error) {
        failed.push(`${instance.presetName}: ${error.message}`);
      }
    }
    failed.push(...instance.failedPresets);
    instance.canvas.remove();
    return { total: names.length, failed };
  });
  check(`All ${presetResult.total} presets run`, presetResult.failed.length === 0, presetResult.failed.slice(0, 5).join(' | '));

  await page.screenshot({ path: 'test-output/milkdrop.png' });

  // Preset browser: key B opens the list, the star and collections decide what plays.
  await page.keyboard.press('b');
  await sleep(450); // It slides in first (0.35 s).
  // The browser always sits at the right edge, however large the collection is.
  const atRightEdge = (place) => place.right === 24 && place.top === 24 && place.bottom === 24;
  const browser1 = await page.evaluate(() => {
    const box = document.getElementById('preset-browser').getBoundingClientRect();
    return {
      open: app.presetBrowser.open,
      place: { right: Math.round(innerWidth - box.right), top: Math.round(box.top), bottom: Math.round(innerHeight - box.bottom) },
      entries: document.querySelectorAll('.pb-entry').length,
    };
  });
  check('Key B opens the preset browser on the right', browser1.open && atRightEdge(browser1.place) && browser1.entries === presetResult.total, JSON.stringify(browser1));
  await page.type('#pb-search', 'v');
  check('Typing in the search does not switch the visualizer', await page.evaluate(() => document.getElementById('hud-title').textContent === 'Milkdrop'));
  await page.$eval('#pb-search', (input) => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
  const picked = await page.evaluate(() => {
    const entry = document.querySelectorAll('.pb-entry')[10];
    entry.querySelector('.pb-select').click();
    return entry.dataset.name;
  });
  check('Clicking in the list loads the preset', await page.evaluate((name) => app.active.presetName === name, picked), picked);
  const favorites = await page.evaluate(async () => {
    const stars = document.querySelectorAll('.pb-star');
    for (const index of [3, 20, 40]) stars[index].click();
    const select = document.getElementById('pb-collection');
    select.value = 'favorites';
    select.dispatchEvent(new Event('change'));
    const played = new Set();
    for (let i = 0; i < 9; i++) {
      app.active.nextPreset();
      played.add(app.active.presetName);
    }
    const box = document.getElementById('preset-browser').getBoundingClientRect();
    return {
      place: { right: Math.round(innerWidth - box.right), top: Math.round(box.top), bottom: Math.round(innerHeight - box.bottom) },
      played: [...played].every((name) => app.library.isFavorite(name)),
      count: played.size,
    };
  });
  check('Favourites: small list also on the right, only favourites play', atRightEdge(favorites.place) && favorites.played && favorites.count === 3, JSON.stringify(favorites));
  await page.screenshot({ path: 'test-output/preset-favorites.png' });
  const custom = await page.evaluate(async () => {
    const id = app.library.createCollection('Test');
    app.library.toggle(id, app.active.presetNames[5]);
    app.library.setActive(id);
    const only = app.active.presetName;
    app.library.deleteCollection(id);
    app.library.setActive('all');
    for (const name of [...app.library.favorites]) app.library.toggleFavorite(name);
    return only === app.active.presetNames[5] || only;
  });
  check('Custom collection plays its preset', custom === true, String(custom));
  await page.keyboard.press('Escape');
  check('Escape closes the browser', await page.evaluate(() => !app.presetBrowser.open));

  // Preset editor: key M, change a base value, broken equation, reset.
  await page.keyboard.press('m');
  await sleep(300);
  const editorOpen = await page.evaluate(() => ({
    open: app.presetEditor.open,
    name: document.querySelector('.pe-name').textContent === app.active.presetName,
    rows: document.querySelectorAll('.pe-base-row').length,
  }));
  check('Key M opens the editor with the current preset', editorOpen.open && editorOpen.name && editorOpen.rows > 50, JSON.stringify(editorOpen));
  // Coloured text under the text area: every token style must be exactly as wide as normal text, otherwise
  // selection and cursor don't match the visible text (this happened with italic comments).
  const tokenWidths = await page.evaluate(() => {
    const area = [...document.querySelectorAll('.pe-code-area')].find((entry) => entry.offsetParent);
    const text = 'Comment äöü // q1 = sin(time*0.5); '.repeat(4);
    const width = (className) => {
      const span = Object.assign(document.createElement('span'), { className, textContent: text });
      Object.assign(span.style, { position: 'absolute', whiteSpace: 'pre', visibility: 'hidden' });
      area.append(span);
      const result = span.getBoundingClientRect().width;
      span.remove();
      return Math.round(result * 10) / 10;
    };
    return Object.fromEntries(['', 'tk-comment', 'tk-number', 'tk-function', 'tk-variable', 'tk-bridge', 'tk-keyword'].map((name) => [name || 'normal', width(name)]));
  });
  check('Coloured editor text is as wide as the text area', Object.values(tokenWidths).every((value) => Math.abs(value - tokenWidths.normal) < 0.5), JSON.stringify(tokenWidths));
  // Scrolled fully down and right, the coloured layer and line numbers must follow exactly (previously off by one line).
  const scrollSync = await page.evaluate(async () => {
    const area = [...document.querySelectorAll('.pe-code-area')].find((entry) => entry.offsetParent);
    const textarea = area.querySelector('textarea');
    const colors = area.querySelector('.pe-highlight');
    const gutter = area.parentElement.querySelector('.pe-gutter');
    const before = textarea.value;
    const long = Array.from({ length: 80 }, (_, i) => `// line ${i + 1} ${'long '.repeat(i % 7 === 0 ? 60 : 3)}`).join('\n');
    textarea.value = long;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(done));
    textarea.scrollTop = textarea.scrollHeight;
    textarea.scrollLeft = textarea.scrollWidth;
    textarea.dispatchEvent(new Event('scroll'));
    await new Promise((done) => requestAnimationFrame(done));
    const result = { textarea: [textarea.scrollTop, textarea.scrollLeft], colors: [colors.scrollTop, colors.scrollLeft], gutter: gutter.scrollTop };
    textarea.value = before;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return result;
  });
  check(
    'Editor: colours and line numbers scroll along to the very bottom and right',
    scrollSync.textarea[0] > 0 && scrollSync.textarea[0] === scrollSync.colors[0] && scrollSync.textarea[1] === scrollSync.colors[1] && scrollSync.gutter === scrollSync.textarea[0],
    JSON.stringify(scrollSync),
  );
  await page.click('.pe-tab[data-tab="base"]');
  await page.type('.pe-pane[data-tab="base"] .pe-filter', 'zoom');
  const zoomInput = await page.evaluateHandle(() => [...document.querySelectorAll('.pe-base-row')].find((row) => row.dataset.key === 'zoom').querySelector('input'));
  await zoomInput.evaluate((input) => {
    input.focus();
    input.select();
  });
  await page.keyboard.type('1,07');
  await sleep(1200);
  const zoomed = await page.evaluate(() => ({
    status: app.presetEditor.status,
    zoom: app.active.currentPreset().edited.baseVals.zoom,
    edited: app.active.currentPreset().isEdited,
    state: document.querySelector('.pe-state').dataset.state,
  }));
  check('Changing a base value takes effect immediately', zoomed.zoom === 1.07 && zoomed.edited && zoomed.state === 'edited' && zoomed.status.kind === 'ok', JSON.stringify(zoomed));
  await zoomInput.evaluate((input) => input.focus());
  await page.keyboard.press('ArrowUp');
  await sleep(1000);
  const stepped = await page.evaluate(() => ({
    zoom: app.active.currentPreset().edited.baseVals.zoom,
    modified: document.querySelector('.pe-tab[data-tab="base"]').classList.contains('modified'),
    groups: [...document.querySelectorAll('.pe-pane[data-tab="base"] .pe-group')].map((group) => group.dataset.group),
    described: document.querySelector('.pe-pane[data-tab="base"] .pe-base-row[data-key="zoom"] .pe-base-text')?.textContent ?? '',
  }));
  check(
    'Base values grouped with explanations, arrow keys fine-tune, tab shows the change',
    stepped.zoom === 1.08 && stepped.modified && stepped.groups[0] === 'motion' && stepped.groups.length >= 6 && stepped.described.startsWith('Zoom'),
    JSON.stringify(stepped),
  );

  await page.evaluate(() => app.presetEditor.selectTab('frame'));
  await page.click('.pe-subpane[data-part="frame"] .pe-textarea');
  await page.keyboard.press('End');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  // Contains a v and an m: typing in the editor must neither switch the visualizer nor close the editor.
  await page.keyboard.type('\nvm = zoom + * 2;');
  await sleep(1200);
  const broken = await page.evaluate(() => ({
    status: app.presetEditor.status,
    tabError: document.querySelector('.pe-tab[data-tab="code"]').classList.contains('has-error'),
    stillGood: !app.active.currentPreset().edited.frame_eqs_eel.includes('* 2'),
    visualizer: document.getElementById('hud-title').textContent,
    open: app.presetEditor.open,
  }));
  check(
    'Broken equation: error with line, last good version keeps running',
    broken.status.kind === 'error' && /Frame, line \d+/.test(broken.status.text) && broken.tabError && broken.stillGood,
    JSON.stringify(broken),
  );
  check('Typing in the editor triggers no shortcuts', broken.visualizer === 'Milkdrop' && broken.open);
  await page.click('.pe-reset');
  await sleep(500);
  const reset = await page.evaluate(() => ({ edited: app.active.currentPreset().isEdited, state: document.querySelector('.pe-state').dataset.state }));
  check('Reset loads the original', !reset.edited && reset.state === 'original', JSON.stringify(reset));
  await page.screenshot({ path: 'test-output/preset-editor.png' });

  // Shapes, waves and shaders. Text is set directly; typing itself was already tested above.
  const setField = (selector, text) =>
    page.evaluate(
      (sel, value) => {
        const field = document.querySelector(sel);
        field.value = value;
        field.dispatchEvent(new Event('input'));
      },
      selector,
      text,
    );
  await page.click('.pe-tab[data-tab="shapes"]');
  await page.evaluate(() => document.querySelectorAll('#preset-editor .pe-pane[data-tab="shapes"] .pe-item')[0].click());
  await page.evaluate(() => {
    const box = document.querySelector('.pe-pane[data-tab="shapes"] .pe-enabled input');
    if (!box.checked) box.click();
  });
  await setField('.pe-pane[data-tab="shapes"] .pe-field:nth-child(2) textarea', 'rad = 0.2 + 0.1*bass;\nsides = 5;');
  await sleep(1200);
  const shape = await page.evaluate(() => ({
    status: app.presetEditor.status,
    shape: app.active.currentPreset().edited.shapes[0],
    buttons: document.querySelectorAll('#preset-editor .pe-pane[data-tab="shapes"] .pe-item').length,
  }));
  check(
    'Enabling a shape and changing its equation takes effect immediately',
    shape.buttons === 4 && shape.status.kind === 'ok' && shape.shape.baseVals.enabled === 1 && shape.shape.frame_eqs_eel.includes('sides = 5'),
    JSON.stringify({ ...shape, shape: { enabled: shape.shape.baseVals.enabled, frame: shape.shape.frame_eqs_eel } }),
  );
  await page.screenshot({ path: 'test-output/preset-editor-shapes.png' });
  await setField('.pe-pane[data-tab="shapes"] .pe-field:nth-child(2) textarea', 'rad = 0.2;\nsides = + ;');
  await sleep(1200);
  const shapeError = await page.evaluate(() => ({
    status: app.presetEditor.status,
    errors: app.presetEditor.errors.map(({ part, line }) => `${part}:${line}`),
    marked: document.querySelectorAll('#preset-editor .pe-pane[data-tab="shapes"] .pe-item')[0].classList.contains('has-error'),
  }));
  check('An error in a shape shows the shape and line', shapeError.errors[0] === 'shape0-frame:2' && /Shape 1 · Frame, line 2/.test(shapeError.status.text) && shapeError.marked, JSON.stringify(shapeError));
  await setField('.pe-pane[data-tab="shapes"] .pe-field:nth-child(2) textarea', 'rad = 0.2;');

  await page.click('.pe-tab[data-tab="waves"]');
  const waveTab = await page.evaluate(() => ({
    buttons: document.querySelectorAll('#preset-editor .pe-pane[data-tab="waves"] .pe-item').length,
    fields: document.querySelectorAll('#preset-editor .pe-pane[data-tab="waves"] textarea').length,
  }));
  check('Waves tab has four waves with init, frame and point', waveTab.buttons === 4 && waveTab.fields === 3, JSON.stringify(waveTab));

  await page.evaluate(() => app.presetEditor.selectTab('warp'));
  const goodWarp = 'shader_body {\n  ret = texture(sampler_main, uv).rgb * 0.97;\n}';
  await setField('.pe-subpane[data-part="warp"] textarea', goodWarp);
  await sleep(1500);
  const warpOk = await page.evaluate((text) => ({ status: app.presetEditor.status, applied: app.active.currentPreset().edited.warp === text }), goodWarp);
  check('Changing the warp shader takes effect immediately', warpOk.status.kind === 'ok' && warpOk.applied, JSON.stringify(warpOk));
  await setField('.pe-subpane[data-part="warp"] textarea', 'shader_body {\n  vec3 a = vec3(1.0);\n  ret = a + unbekannt;\n}');
  await sleep(1500);
  const warpError = await page.evaluate((text) => ({
    status: app.presetEditor.status,
    errors: app.presetEditor.errors.map(({ part, line }) => `${part}:${line}`),
    stillGood: app.active.currentPreset().edited.warp === text,
    gutter: document.querySelector('.pe-subpane[data-part="warp"] .pe-gutter .error')?.textContent.trim(),
  }), goodWarp);
  check(
    'Broken shader: error with line, last good version keeps running',
    warpError.errors[0] === 'warp:3' && /Warp, line 3: Unknown name “unbekannt”/.test(warpError.status.text) && warpError.stillGood && warpError.gutter === '3',
    JSON.stringify(warpError),
  );
  await page.screenshot({ path: 'test-output/preset-editor-shader.png' });
  await page.click('.pe-reset');
  await sleep(500);

  // New from template: create and run every template.
  const templateIds = await page.$$eval('.pe-template', (buttons) => buttons.map((button) => button.dataset.template));
  const templateResults = [];
  for (const [i, id] of templateIds.entries()) {
    await page.click('.pe-new');
    if (i === 0) await page.type('.pe-new-menu input', 'Test - Template');
    await page.click(`.pe-template[data-template="${id}"]`);
    await sleep(800);
    templateResults.push(
      await page.evaluate((templateId) => {
        const failed = app.active.failedPresets;
        return {
          id: templateId,
          playing: app.active.presetName,
          state: document.querySelector('.pe-state').dataset.state,
          status: app.presetEditor.status.kind,
          failed: failed.filter((entry) => entry.startsWith(app.active.presetName)).length,
        };
      }, id),
    );
  }
  check(
    'Every template can be created and runs',
    templateIds.length >= 4 &&
      templateResults[0].playing === 'Test - Template' &&
      templateResults.every((result) => result.state === 'new' && result.status === 'ok' && result.failed === 0),
    JSON.stringify(templateResults),
  );
  // The last template has its own shaders: add a character, then the editor checks them with WebGL.
  await page.evaluate(() => app.presetEditor.selectTab('comp'));
  await page.evaluate(() => {
    const field = document.querySelector('.pe-subpane[data-part="comp"] textarea');
    field.value += '\n';
    field.dispatchEvent(new Event('input'));
  });
  await sleep(1500);
  const templateShader = await page.evaluate(() => app.presetEditor.status);
  check('Template shaders compile without errors', templateShader.kind === 'ok', JSON.stringify(templateShader));
  await page.screenshot({ path: 'test-output/preset-editor-template.png' });
  await page.click('.pe-close');
  check('Editor closes', await page.evaluate(() => !app.presetEditor.open));

  // On wide windows the preset browser and editor sit side by side.
  await page.setViewport({ width: 1280, height: 720 });
  const panelRects = () =>
    page.evaluate(() => {
      const rect = (id) => {
        const element = document.getElementById(id);
        if (element.hidden) return null;
        const { left, right } = element.getBoundingClientRect();
        return { left: Math.round(left), right: Math.round(right) };
      };
      return { browser: rect('preset-browser'), editor: rect('preset-editor'), animation: getComputedStyle(document.getElementById('preset-editor')).animationName };
    });
  await page.keyboard.press('b');
  await sleep(250);
  const slide = await page.evaluate(() => getComputedStyle(document.getElementById('preset-browser')).animationName);
  check('Preset browser slides in from the right like the editors', slide === 'pe-slide-in', slide);
  await sleep(400);
  await page.keyboard.press('m');
  await sleep(600);
  const besides = await panelRects();
  check(
    'Editor with the browser open: browser moves left, editor slides in from the right',
    besides.browser && besides.editor && besides.browser.right <= besides.editor.left && besides.editor.right === 1280 - 24 && besides.animation === 'pe-slide-in',
    JSON.stringify(besides),
  );
  await page.click('.pe-tab[data-tab="base"]');
  await sleep(100);
  check('Clicking into the editor keeps the browser open', await page.evaluate(() => app.presetBrowser.open && app.presetEditor.open));
  await page.keyboard.press('b');
  await sleep(100);
  await page.keyboard.press('b');
  await sleep(600);
  const reopened29 = await panelRects();
  check('Browser opened with the editor open appears to its left', reopened29.browser && reopened29.editor && reopened29.browser.right <= reopened29.editor.left, JSON.stringify(reopened29));
  await page.screenshot({ path: 'test-output/editor-and-browser.png' });

  // Second panel for reference (key N): left of the editor, browser far left. Too narrow: the browser closes.
  await page.keyboard.press('n');
  await sleep(600);
  check('Reference at 1280 px: browser makes room', await page.evaluate(() => app.presetReference.open && app.presetEditor.open && !app.presetBrowser.open));
  await page.setViewport({ width: 1700, height: 720 });
  await page.keyboard.press('b');
  await sleep(1200);
  const three = await page.evaluate(() => {
    const rect = (id) => {
      const { left, right } = document.getElementById(id).getBoundingClientRect();
      return { left: Math.round(left), right: Math.round(right) };
    };
    const reference = document.getElementById('preset-reference');
    return {
      editor: rect('preset-editor'),
      reference: rect('preset-reference'),
      browser: rect('preset-browser'),
      shown: app.presetReference.shownName,
      playing: app.active.presetName,
      readOnly: [...reference.querySelectorAll('textarea')].every((field) => field.readOnly),
      buttons: [...reference.querySelectorAll('header button')].map((button) => button.textContent.trim()),
    };
  });
  check(
    'Reference sits between browser and editor, shows the current preset, read-only',
    three.browser.right <= three.reference.left && three.reference.right <= three.editor.left && three.shown === three.playing && three.readOnly && three.buttons.join() === '×',
    JSON.stringify(three),
  );
  const other = await page.evaluate(async () => {
    const name = app.active.presetNames.find((item) => item !== app.active.presetName && item.startsWith('Geiss'));
    const playing = app.active.presetName;
    app.presetReference.showPreset(name);
    const frame = document.querySelector('#preset-reference .pe-subpane[data-part="frame"] textarea');
    frame.focus();
    const before = frame.value;
    document.execCommand('insertText', false, 'kaputt');
    await new Promise((done) => setTimeout(done, 600));
    return {
      shown: app.presetReference.shownName === name,
      stillPlaying: app.active.presetName === playing,
      unchanged: frame.value === before,
      editorName: app.presetEditor.open && document.querySelector('#preset-editor .pe-name').textContent === playing,
    };
  });
  check('Reference shows another preset; the current one and the editor stay', Object.values(other).every(Boolean), JSON.stringify(other));
  await page.screenshot({ path: 'test-output/nachschauen.png' });
  await page.keyboard.press('Escape');
  await sleep(100);
  check('Escape closes all three panels', await page.evaluate(() => !app.presetReference.open && !app.presetEditor.open && !app.presetBrowser.open));
  await page.setViewport({ width: 1280, height: 720 });
  await page.keyboard.press('b');
  await sleep(200);
  await page.keyboard.press('m');
  await sleep(600);
  await page.setViewport({ width: 800, height: 450 });
  await sleep(200);
  check('Narrow window: only the editor stays open', await page.evaluate(() => !app.presetBrowser.open && app.presetEditor.open));

  // Alt hides all menus; the mouse does not bring them back, Alt or Escape do. Alt+key does not count.
  const menuState = () =>
    page.evaluate(() => ({
      hidden: app.menusHidden,
      hud: getComputedStyle(document.getElementById('hud')).visibility,
      editor: getComputedStyle(document.getElementById('preset-editor')).visibility,
      editorOpen: app.presetEditor.open,
    }));
  await page.keyboard.press('Alt');
  await page.mouse.move(200, 200);
  await page.mouse.move(400, 300);
  await sleep(200);
  const altHidden = await menuState();
  check('Alt hides all menus, mouse movement does not show them', altHidden.hidden && altHidden.hud === 'hidden' && altHidden.editor === 'hidden' && altHidden.editorOpen, JSON.stringify(altHidden));
  await page.keyboard.press('Escape');
  await sleep(100);
  const escShown = await menuState();
  check('Escape shows the menus again, open panels stay open', !escShown.hidden && escShown.hud === 'visible' && escShown.editor === 'visible' && escShown.editorOpen, JSON.stringify(escShown));
  await page.keyboard.press('Alt');
  await page.keyboard.press('Alt');
  await page.keyboard.down('Alt');
  await page.keyboard.press('x');
  await page.keyboard.up('Alt');
  const altCombo = await menuState();
  check('Pressing Alt twice shows them again, Alt with another key does not hide', !altCombo.hidden && altCombo.hud === 'visible', JSON.stringify(altCombo));
  await page.keyboard.press('Escape');
  await sleep(100);

  // Custom presets: custom-milk folder. A folder picker is impossible in the test, so the origin private file system is used instead.
  const OWN_NAME = 'Test - Own preset';
  const BASE_NAME = 'Waltra - Square Orgy';
  await page.evaluate(async (ownName) => {
    const dir = await navigator.storage.getDirectory();
    for (const folder of ['own', 'edited', 'eigene', 'bearbeitet']) await dir.removeEntry(folder, { recursive: true }).catch(() => {});
    const write = async (folder, name) => {
      const folderDir = await dir.getDirectoryHandle(folder, { create: true });
      const writable = await (await folderDir.getFileHandle(`${name}.milk`, { create: true })).createWritable();
      await writable.write('MILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0.95\nzoom=1.02\nper_frame_1=rot = 0.02*sin(time);\n');
      await writable.close();
    };
    await write('own', ownName);
    await write('eigene', `${ownName} (old folder)`); // folder name of earlier versions, still read
    await app.customPresets.store.useDirectory(dir);
    await app.customPresets.reload();
  }, OWN_NAME);
  const own = await page.evaluate(async (ownName) => {
    const failedBefore = app.active.failedPresets.length;
    await app.active.selectPreset(ownName, { blendSeconds: 0 });
    for (let i = 0; i < 10; i++) await new Promise((done) => requestAnimationFrame(done));
    return {
      listed: app.active.presetNames.includes(ownName),
      ownCollection: app.library.namesOf('own', app.active.presetNames),
      playing: app.active.presetName === ownName,
      failed: app.active.failedPresets.slice(failedBefore),
    };
  }, OWN_NAME);
  check(
    'Custom presets from own/ and the old eigene/ are in the list and in "Own", and play',
    own.listed && own.playing && own.ownCollection.length === 2 && own.ownCollection.includes(`${OWN_NAME} (old folder)`) && own.failed.length === 0,
    JSON.stringify(own),
  );

  await page.evaluate((name) => app.active.selectPreset(name, { blendSeconds: 0 }), BASE_NAME);
  await page.keyboard.press('m');
  await sleep(300);
  await page.click('.pe-tab[data-tab="base"]');
  await page.$eval('.pe-pane[data-tab="base"] .pe-filter', (input) => (input.value = ''));
  await page.type('.pe-pane[data-tab="base"] .pe-filter', 'zoom');
  const saveZoom = await page.evaluateHandle(() => [...document.querySelectorAll('.pe-base-row')].find((row) => row.dataset.key === 'zoom').querySelector('input'));
  await saveZoom.evaluate((input) => {
    input.focus();
    input.select();
  });
  await page.keyboard.type('1.03');
  await page.click('.pe-save');
  await sleep(1500);
  const saved = await page.evaluate(async (baseName) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('edited');
    const text = await (await (await dir.getFileHandle(`${baseName} (edited).milk`)).getFile()).text();
    return {
      playing: app.active.presetName,
      state: document.querySelector('.pe-state').dataset.state,
      status: app.presetEditor.status,
      originalUntouched: !app.active.isEdited(baseName),
      fileHasZoom: /\nzoom=1\.03\n/.test(text),
      fileHasOrigin: text.includes(`butterchurn_based_on=${baseName}`),
    };
  }, BASE_NAME);
  check(
    'Saving writes a variant to edited/ and plays it',
    saved.playing === `${BASE_NAME} (edited)` && saved.state === 'saved' && saved.status.kind === 'ok' && saved.originalUntouched && saved.fileHasZoom && saved.fileHasOrigin,
    JSON.stringify(saved),
  );
  await page.screenshot({ path: 'test-output/preset-saved.png' });
  await page.keyboard.press('Escape');

  // New window: the remembered folder is read again without asking.
  const reopened = await browser.newPage();
  await reopened.setViewport({ width: 800, height: 450 });
  await reopened.goto(`${baseUrl}?demo=1`);
  await reopened.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  const ownRestored = await reopened.evaluate(() => ({ state: app.customPresets.state, names: app.library.namesOf('own', app.active.presetNames) }));
  check(
    'Custom presets are back after reloading',
    ownRestored.state === 'connected' && ownRestored.names.includes(OWN_NAME) && ownRestored.names.includes(`${BASE_NAME} (edited)`),
    JSON.stringify(ownRestored),
  );
  await reopened.close();

  // As in Brave: no folder access. Custom presets stay in the browser, saving downloads the file.
  const braveDownloads = resolve('test-output/downloads');
  const braveImport = resolve('test-output/import/Test - Opened.milk');
  rmSync(braveDownloads, { recursive: true, force: true });
  mkdirSync(braveDownloads, { recursive: true });
  mkdirSync(resolve('test-output/import'), { recursive: true });
  writeFileSync(braveImport, 'MILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0.95\nzoom=1.02\nper_frame_1=rot = 0.01;\n');
  const brave = await browser.newPage();
  await brave.evaluateOnNewDocument(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }));
  await (await brave.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: braveDownloads });
  await brave.setViewport({ width: 800, height: 450 });
  await brave.goto(`${baseUrl}?demo=1`);
  await brave.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  await (await brave.$('.pb-folder-files')).uploadFile(braveImport);
  await brave.waitForFunction(() => app.active.presetNames.includes('Test - Opened'), { timeout: 5000 }).catch(() => {});
  const opened = await brave.evaluate(() => ({
    state: app.customPresets.state,
    own: app.library.namesOf('own', app.active.presetNames),
    playing: app.active.presetName,
    openButton: !document.querySelector('.pb-folder-open').hidden,
    text: document.querySelector('.pb-folder-text').textContent,
  }));
  check(
    'Without folder access: "Open files" loads a .milk file and plays it',
    opened.state === 'browser' && opened.openButton && opened.own.includes('Test - Opened') && opened.playing === 'Test - Opened',
    JSON.stringify(opened),
  );
  await brave.keyboard.press('m');
  await sleep(300);
  await brave.click('.pe-tab[data-tab="base"]');
  await brave.type('.pe-pane[data-tab="base"] .pe-filter', 'zoom');
  const braveZoom = await brave.evaluateHandle(() => [...document.querySelectorAll('.pe-base-row')].find((row) => row.dataset.key === 'zoom').querySelector('input'));
  await braveZoom.evaluate((input) => {
    input.focus();
    input.select();
  });
  await brave.keyboard.type('1.04');
  await brave.click('.pe-save');
  await sleep(2000);
  const braveStatus = await brave.evaluate(() => app.presetEditor.status);
  let downloaded = '';
  try {
    downloaded = readFileSync(join(braveDownloads, 'Test - Opened.milk'), 'utf8');
  } catch {}
  check('Without folder access: saving downloads the .milk file', braveStatus.kind === 'ok' && /\nzoom=1\.04\n/.test(downloaded), JSON.stringify(braveStatus));
  await brave.reload();
  await brave.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  const braveKept = await brave.evaluate(async () => {
    await app.active.selectPreset('Test - Opened', { blendSeconds: 0 });
    return { zoom: app.active.currentPreset().original.baseVals.zoom, own: app.library.namesOf('own', app.active.presetNames) };
  });
  check('Without folder access: saved presets are still there after reloading', braveKept.zoom === 1.04, JSON.stringify(braveKept));

  // Backup of favourites and collections: download, clear everything, restore.
  await brave.evaluate(() => {
    app.library.toggleFavorite('Waltra - Square Orgy');
    const id = app.library.createCollection('Test backup');
    app.library.toggle(id, 'Test - Opened');
  });
  await brave.$eval('.pb-backup', (button) => button.click());
  await sleep(1500);
  let backupText = '';
  try {
    backupText = readFileSync(join(braveDownloads, 'butterglow-collections.json'), 'utf8');
  } catch {}
  await brave.evaluate(() => {
    app.library.toggleFavorite('Waltra - Square Orgy');
    app.library.deleteCollection(app.library.customCollections.find((entry) => entry.name === 'Test backup').id);
  });
  await (await brave.$('.pb-folder-files')).uploadFile(join(braveDownloads, 'butterglow-collections.json'));
  await sleep(1000);
  const restoredLibrary = await brave.evaluate(() => ({
    favorite: app.library.isFavorite('Waltra - Square Orgy'),
    collection: app.library.customCollections.some((entry) => entry.name === 'Test backup'),
    text: document.querySelector('.pb-folder-text').textContent,
  }));
  check(
    'Backup downloads favourites and collections, opening restores them',
    backupText.includes('Test backup') && restoredLibrary.favorite && restoredLibrary.collection,
    JSON.stringify(restoredLibrary),
  );
  await brave.keyboard.press('b');
  await sleep(400);
  await brave.screenshot({ path: 'test-output/preset-browser-brave.png' });
  await brave.close();

  await page.bringToFront(); // back in front after the other windows, otherwise Chrome throttles the render loop
  // Auto preset change with a custom time: "Custom time …" shows a number field, 2 s really switches.
  const customAdvance = await page.evaluate(async () => {
    const menu = document.getElementById('hud-menu');
    const wasClosed = menu.hidden;
    if (wasClosed) document.getElementById('hud-menu-toggle').click(); // the number field can only be focused while visible
    const select = [...document.querySelectorAll('#hud-active-settings select')].find((entry) => [...entry.options].some((option) => option.value === 'custom'));
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 50));
    const number = select.closest('.setting').querySelector('.setting-custom');
    const shown = !number.closest('.setting-custom-wrap').hidden;
    const focused = document.activeElement === number;
    number.value = '2';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    const before = app.active.presetName;
    await new Promise((done) => setTimeout(done, 3000));
    const changed = app.active.presetName !== before;
    select.value = '0';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (wasClosed) document.getElementById('hud-menu-toggle').click();
    return { shown, focused, changed, hiddenAgain: number.closest('.setting-custom-wrap').hidden };
  });
  check('Custom preset change time: number field appears, 2 s switches the preset', Object.values(customAdvance).every(Boolean), JSON.stringify(customAdvance));
  // By default Milkdrop renders at 60 fps, even when the loop runs faster (240 Hz monitor).
  const milkdropRate = await page.evaluate(async () => {
    app.scheduler.setLimit(240);
    const milkdrop = app.active;
    const render = milkdrop.render;
    let calls = 0;
    let drawn = 0;
    milkdrop.render = (...args) => {
      render.apply(milkdrop, args);
      calls++;
      if (milkdrop.drewLastFrame) drawn++;
    };
    await new Promise((done) => setTimeout(done, 2000));
    milkdrop.render = render;
    app.scheduler.setLimit('vsync');
    return { setting: milkdrop.settings?.frameRate, loopPerSecond: calls / 2, drawnPerSecond: drawn / 2 };
  });
  check(
    'Milkdrop renders at most 60 fps, even with a faster loop',
    // Never more than 60, but never stalled either. Under load the test loop is uneven, hence the loose bounds.
    milkdropRate.drawnPerSecond <= 63 && milkdropRate.drawnPerSecond > 5 && (milkdropRate.loopPerSecond < 100 || milkdropRate.drawnPerSecond >= 30),
    JSON.stringify(milkdropRate),
  );

  // Transition: counts how many frames were actually blended. The switch back to Milkdrop is measured:
  // when the neon ring is first created, the software renderer in the test compiles shaders and stalls longer
  // than the whole transition. On a real GPU this only takes milliseconds.
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Neon Ring');
  await page.waitForFunction(() => !app.crossfade.running, { timeout: 10000 });
  await sleep(1000);
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop');
  const midFade = await page.evaluate(() => ({
    running: app.crossfade.running,
    visible: [...document.querySelectorAll('#stage canvas:not(#water)')].filter((canvas) => !canvas.hidden).length,
    waterPaused: app.waterPaused,
    water: document.getElementById('water').style.opacity,
  }));
  await page.screenshot({ path: 'test-output/crossfade.png' });
  check(
    'Switching with V starts the crossfade, both images visible, water paused',
    midFade.running && midFade.visible === 2 && midFade.waterPaused && midFade.water === '0',
    JSON.stringify(midFade),
  );
  await page.waitForFunction(() => !app.crossfade.running, { timeout: 10000 });
  await sleep(100);
  const afterFade = await page.evaluate(() => ({
    last: app.crossfade.last,
    visible: [...document.querySelectorAll('#stage canvas:not(#water)')].filter((canvas) => !canvas.hidden).length,
    water: document.getElementById('water').style.opacity,
  }));
  check(
    'Crossfade ran over several frames, then only the new visualizer and water again',
    afterFade.last?.duration === 1000 && afterFade.last.frames >= 3 && afterFade.visible === 1 && afterFade.water === '',
    JSON.stringify(afterFade),
  );
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Neon Ring');
  await page.waitForFunction(() => !app.crossfade.running, { timeout: 10000 });
  await page.screenshot({ path: 'test-output/neon.png' });
  check('Key V switches the visualizer', true);
  const realErrors = errors.filter((error) => !error.includes('WebGL') && !error.includes('GL_'));
  check('No errors in the console', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

  // Debug view: key D opens it, the values fill in.
  await page.keyboard.press('d');
  await sleep(1500);
  const debugView = await page.evaluate(() => {
    const values = Object.fromEntries(
      [...document.querySelectorAll('#debug dt')].map((term) => [term.dataset.key, term.nextElementSibling.textContent]),
    );
    return { open: !document.getElementById('debug').hidden, values };
  });
  check(
    'Key D shows debug values',
    debugView.open && Number(debugView.values.fps) > 0 && debugView.values.gpu?.length > 0 && debugView.values.visualizerImage === '800×450',
    JSON.stringify(debugView.values),
  );

  // The debug view sits top left and only moves aside when the settings menu is open.
  const debugLeft = async () => {
    await page.mouse.move(500, 100 + Math.random() * 50);
    await sleep(500);
    return page.$eval('#debug', (debug) => Math.round(debug.getBoundingClientRect().left));
  };
  const menuWasOpen = await page.$eval('#hud-menu', (menu) => !menu.hidden);
  if (menuWasOpen) await page.click('#hud-menu-toggle');
  const closedLeft = await debugLeft();
  await page.click('#hud-menu-toggle');
  const openLeft = await debugLeft();
  if (!menuWasOpen) await page.click('#hud-menu-toggle');
  check('Debug view only moves aside for the open settings menu', closedLeft === 16 && openLeft > 300, JSON.stringify({ closedLeft, openLeft }));

  // Frame limit: 15 keeps the frame rate at 15, unlimited runs without vsync, closing switches back.
  const setLimit = (index) =>
    page.$eval('.debug-limit input', (input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input'));
    }, index);
  const fpsShown = () => page.$eval('#debug dl', (list) => Number([...list.querySelectorAll('dt')].find((term) => term.dataset.key === 'fps').nextElementSibling.textContent));
  await setLimit(1);
  await sleep(2500);
  const limited = await fpsShown();
  await setLimit(16);
  await sleep(2500);
  const unlimited = await fpsShown();
  const unlimitedMode = await page.evaluate(() => app.scheduler.limit);
  check('Frame limit 15 keeps the frame rate at 15', limited >= 12 && limited <= 16, String(limited));
  check('Unlimited frame limit runs without vsync', unlimitedMode === Infinity && unlimited > limited, `${unlimited} fps`);
  // Milkdrop's own frame rate (here 30) is ignored while the debug view is open, so "FPS" counts frames really drawn.
  const countDraws = () =>
    page.evaluate(async () => {
      const select = document.querySelector('#hud-active-settings [data-setting="milkdrop.frameRate"] select');
      select.value = '30';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const counts = { drawn: 0, skipped: 0 };
      const instance = app.active;
      const original = instance.render;
      instance.render = function (frame) {
        original.call(this, frame);
        counts[this.drewLastFrame ? 'drawn' : 'skipped']++;
      };
      // At least 20 frames: with slow software rendering one second is sometimes only a handful.
      const until = performance.now() + 8000;
      while (counts.drawn + counts.skipped < 20 && performance.now() < until) await new Promise((done) => setTimeout(done, 100));
      instance.render = original;
      select.value = '60';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return counts;
    });
  const showVisualizer = (index) =>
    page.evaluate(async (target) => {
      await app.activate(target);
      while (app.crossfade.running) await new Promise((done) => setTimeout(done, 20));
    }, index);
  await showVisualizer(0);
  const drawsOpen = await countDraws();
  await page.keyboard.press('d');
  const drawsClosed = await countDraws();
  await page.keyboard.press('d');
  await showVisualizer(1);
  check(
    'With the debug view open Milkdrop draws every frame, closed it keeps its own frame rate',
    drawsOpen.drawn > 0 && drawsOpen.skipped === 0 && drawsClosed.skipped > 0,
    JSON.stringify({ drawsOpen, drawsClosed }),
  );
  await page.keyboard.press('d');
  const closedMode = await page.evaluate(() => app.scheduler.limit);
  await page.keyboard.press('d');
  const reopenedMode = await page.evaluate(() => app.scheduler.limit);
  check('Closed debug view uses vsync again; when reopened the limit applies again', closedMode === 'vsync' && reopenedMode === Infinity, `${closedMode} / ${reopenedMode}`);
  await setLimit(0);

  // Quality: Low halves the resolution, High restores it.
  await page.click('#hud-menu-toggle');
  const qualitySelect = await page.evaluateHandle(() =>
    [...document.querySelectorAll('#hud-shared-settings select')].find((select) => [...select.options].some((option) => option.value === 'lowest')),
  );
  await qualitySelect.select('low');
  await sleep(300);
  const lowSize = await page.evaluate(() => [app.active.canvas.width, app.active.canvas.height, document.getElementById('water').width]);
  await qualitySelect.select('high');
  await sleep(300);
  const highSize = await page.evaluate(() => [app.active.canvas.width, app.active.canvas.height, document.getElementById('water').width]);
  check('Quality Low halves the resolution, High restores it', lowSize.join() === '400,225,400' && highSize.join() === '800,450,800', `${lowSize} → ${highSize}`);
  await page.click('#hud-menu-toggle');
  await page.keyboard.press('d');
  check('Key D closes the debug view', await page.$eval('#debug', (panel) => panel.hidden));

  // Settings menu and pin: without mouse movement the icon always disappears, the menu only when unpinned.
  const hudState = () =>
    page.evaluate(() => ({
      hudVisible: getComputedStyle(document.getElementById('hud')).opacity === '1',
      pinVisible: getComputedStyle(document.getElementById('hud-pin')).opacity === '1',
      menuOpen: !document.getElementById('hud-menu').hidden,
      idle: document.body.classList.contains('idle'),
    }));
  await page.mouse.move(600, 200);
  await page.click('#hud-menu-toggle');
  await page.mouse.move(600, 210);
  await sleep(600);
  let hud = await hudState();
  check('Menu opens, pin is visible', hud.menuOpen && hud.pinVisible && hud.hudVisible, JSON.stringify(hud));
  await sleep(3800);
  hud = await hudState();
  check('Without pin the menu disappears after 3 seconds', hud.idle && !hud.hudVisible && !hud.pinVisible, JSON.stringify(hud));
  // Open dropdown (focused select): the menu stays until a choice is made.
  await page.mouse.move(600, 215);
  await page.$eval('#hud-visualizer', (select) => select.focus());
  await sleep(3800);
  const withDropdown = await hudState();
  await page.$eval('#hud-visualizer', (select) => select.blur());
  await sleep(3500);
  const afterDropdown = await hudState();
  check(
    'With an open dropdown the menu does not hide, then back to normal',
    !withDropdown.idle && withDropdown.hudVisible && afterDropdown.idle && !afterDropdown.hudVisible,
    JSON.stringify({ withDropdown, afterDropdown }),
  );
  await page.mouse.move(600, 220);
  await page.click('#hud-pin');
  await page.mouse.move(600, 230);
  await sleep(4300);
  hud = await hudState();
  check('With pin the menu stays, only the icon disappears', hud.idle && hud.hudVisible && !hud.pinVisible && hud.menuOpen, JSON.stringify(hud));
  const keysHidden = await page.$eval('#hud-keys', (keys) => getComputedStyle(keys).opacity === '0' && keys.getBoundingClientRect().height < 1);
  check('Key hints disappear like the pin', keysHidden);
  await page.mouse.move(600, 250);
  await page.click('#hud-keys-toggle');
  await page.mouse.move(600, 260);
  const keysOff = await page.$eval('#hud-keys', (keys) => keys.getBoundingClientRect().height < 1 && !document.body.classList.contains('idle'));
  await page.click('#hud-keys-toggle');
  await sleep(500);
  const keysOn = await page.$eval('#hud-keys', (keys) => keys.getBoundingClientRect().height > 20);
  check('Button hides and shows the key hints', keysOff && keysOn, JSON.stringify({ keysOff, keysOn }));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  hud = await hudState();
  check('Pin and menu survive reloading', hud.menuOpen, JSON.stringify(hud));

  // The setting takes effect and persists, then back to the initial state.
  await page.mouse.move(600, 240);
  await page.click('#hud-pin');
  await page.click('#hud-menu-toggle');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Neon Ring');
  // Coming from Milkdrop the water rests during the cross-fade.
  await page.waitForFunction(() => !app.crossfade.running, { timeout: 10000 });
  await sleep(200);
  const waterShown = await page.$eval('#water', (canvas) => !canvas.hidden && canvas.width > 0);
  check('Water is shown', waterShown);

  // "Show water" belongs to each visualizer: Milkdrop starts without water, switching on is remembered for Milkdrop only.
  const waterPerVisualizer = await page.evaluate(async () => {
    const show = async (index) => {
      await app.activate(index, { durationMs: 0 });
      while (app.crossfade.running) await new Promise((done) => setTimeout(done, 20));
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      return !document.getElementById('water').hidden;
    };
    const toggle = (checked) => {
      const input = document.querySelector('#hud-active-settings [data-setting="milkdrop.water"] input');
      input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const milkdropDefault = await show(0);
    toggle(true);
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const milkdropOn = !document.getElementById('water').hidden;
    const neonRing = await show(1);
    const milkdropRemembered = await show(0);
    toggle(false);
    const neonRingAfter = await show(1);
    return { milkdropDefault, milkdropOn, neonRing, milkdropRemembered, neonRingAfter };
  });
  check(
    'Water is set per visualizer: off for Milkdrop by default, remembered when switched on',
    !waterPerVisualizer.milkdropDefault && waterPerVisualizer.milkdropOn && waterPerVisualizer.neonRing && waterPerVisualizer.milkdropRemembered && waterPerVisualizer.neonRingAfter,
    JSON.stringify(waterPerVisualizer),
  );

  // Ripples: the demo beat must keep triggering new rings.
  const ringCount = await page.evaluate(async () => {
    await new Promise((done) => setTimeout(done, 2000));
    return app.water.ripples.waves.events.length;
  });
  check('Demo beat triggers ripples', ringCount > 3, `${ringCount} rings`);
  await page.screenshot({ path: 'test-output/water-neon.png' });

  // A single ring: centred on the point below the visualizer and travelling outwards, measured on the water surface.
  const ring = await page.evaluate(async () => {
    const { settings, ripples, canvas } = app.water;
    const saved = { waves: settings.waves, vibration: settings.vibration };
    settings.waves = 0;
    settings.vibration = 0;
    ripples.waves.events = [];
    ripples.waves.add({ size: 0.3, height: 0.3 });
    const level = settings.level / 100;
    const aspect = canvas.width / canvas.height;
    const sourceZ = 0.5 / (level * 0.45);
    const sample = (x, z) => {
      const t = 0.5 / (sourceZ + z);
      return ripples.readField(0.5 + (x * t) / aspect, level - t).height;
    };
    // Only as far as the water surface towards the viewer is in the image.
    const nearest = 0.5 / level;
    const radii = Array.from({ length: 60 }, (_, index) => 0.1 + (index * (sourceZ - nearest - 0.2)) / 60);
    const profile = (dx, dz) => radii.map((radius) => sample(dx * radius, dz * radius));
    // There is more room to the sides, where the front can be followed far.
    const frontOf = (limit) => {
      for (let radius = 12; radius > 0; radius -= 0.05) if (Math.abs(sample(radius, 0)) > limit) return radius;
      return 0;
    };

    await new Promise((done) => setTimeout(done, 400));
    const frontEarly = frontOf(0.008);
    await new Promise((done) => setTimeout(done, 700));
    const frontLate = frontOf(0.008);
    const [right, left, near] = [profile(1, 0), profile(-1, 0), profile(0, -1)];
    const peak = Math.max(...right.map(Math.abs));
    const worst = (other) => Math.max(...right.map((value, index) => Math.abs(value - other[index]))) / peak;
    const result = { peak, frontEarly, frontLate, leftRight: worst(left), sideNear: worst(near) };
    Object.assign(settings, saved);
    return result;
  });
  check('Ring travels outwards', ring.frontLate > ring.frontEarly + 0.5, JSON.stringify(ring));
  check('Ring is symmetric left and right', ring.leftRight < 0.1);
  check('Ring is circular on the water surface', ring.sideNear < 0.3);

  // On calm water the reflection must be as sharp as the image. A fine stripe pattern shows this clearly.
  const mirrorDetail = await page.evaluate(async () => {
    const { settings, ripples, canvas } = app.water;
    const saved = { waves: settings.waves, vibration: settings.vibration, preset: settings.preset, reflection: settings.reflection };
    Object.assign(settings, { waves: 0, vibration: 0, reflection: 100 });
    const pattern = document.createElement('canvas');
    pattern.width = canvas.width;
    pattern.height = canvas.height;
    const context = pattern.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, pattern.width, pattern.height);
    context.fillStyle = '#fff';
    for (let x = 0; x < pattern.width; x += 4) context.fillRect(x, 0, 2, pattern.height);

    const measure = (name) => new Promise((done) => {
      settings.preset = name;
      const original = app.water.render;
      let frames = 0;
      app.water.render = (frame) => {
        // Clear running rings so the water is calm. The swell follows the wave sliders and is calm too.
        if (app.water.ripples) app.water.ripples.waves.events = [];
        original(frame, pattern);
        if (++frames < 6) return;
        app.water.render = original;
        const gl = canvas.getContext('webgl2');
        const row = new Uint8Array(canvas.width * 4);
        const level = settings.level / 100;
        gl.readPixels(0, Math.round((level - 0.06) * canvas.height), canvas.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
        const values = row.filter((_, index) => index % 4 === 0);
        // Stripe contrast: 0 is grey mush, 255 would be the full difference.
        let sum = 0;
        for (let x = 2; x < values.length; x++) sum += Math.abs(values[x] - values[x - 2]);
        done(sum / (values.length - 2));
      };
    });
    const livelyDetail = await measure('lively');
    const ripplesDetail = await measure('ripples');
    const classicDetail = await measure('classic');
    Object.assign(settings, saved);
    return { lively: livelyDetail, ripples: ripplesDetail, classic: classicDetail };
  });
  check(
    'Reflection in Lively and Ripples is much sharper than in Classic',
    Math.min(mirrorDetail.lively, mirrorDetail.ripples) > mirrorDetail.classic * 2 && Math.min(mirrorDetail.lively, mirrorDetail.ripples) > 100,
    JSON.stringify(mirrorDetail),
  );

  // Strength slider: at 300 % the same kicks make much higher waves than at 100 %.
  const strengthHeights = await page.evaluate(async () => {
    const { settings } = app.water;
    const heightAt = async (strength) => {
      settings.strength = strength;
      await new Promise((done) => setTimeout(done, 1500));
      return Math.max(...app.water.ripples.waves.events.map((event) => event.height));
    };
    const normal = await heightAt(100);
    const strong = await heightAt(300);
    settings.strength = 100;
    return { normal, strong };
  });
  check('Strength slider makes the waves higher', strengthHeights.strong > strengthHeights.normal * 2, JSON.stringify(strengthHeights));

  // The old water is kept as a preset and still reacts to kicks.
  const swellRange = await page.evaluate(async () => {
    app.water.settings.preset = 'classic';
    let range = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise((done) => setTimeout(done, 50));
      const { heights } = app.water.surface;
      range = Math.max(range, Math.max(...heights) - Math.min(...heights));
    }
    return range;
  });
  check('Classic preset: kicks move the water', swellRange > 0.3, swellRange.toFixed(2));
  await page.screenshot({ path: 'test-output/water-classic.png' });
  await page.evaluate(() => {
    app.water.settings.preset = 'lively';
  });
  const presetOptions = await page.$$eval('#hud-shared-settings [data-setting="water.preset"] option', (options) => options.map((option) => option.value));
  check(
    'Menu offers all three water presets',
    ['lively', 'ripples', 'classic'].every((name) => presetOptions.includes(name)),
    presetOptions.join(', '),
  );
  check('Menu has the strength slider', await page.$$eval('#hud-shared-settings [data-setting="water.strength"] input', (inputs) => inputs.length === 1));
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop');
  await sleep(800);
  await page.screenshot({ path: 'test-output/water-milkdrop.png' });
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Neon Ring');

  // Visconf editor: timeline with waveform and markers, dragging, new markers and cues, playback of the plan.
  // The demo player reports "Demo-Beat" with the audio time as position, so the plan can play without a tab.
  {
    const vcPage = await browser.newPage();
    const vcErrors = collectErrors(vcPage);
    await vcPage.setViewport({ width: 1400, height: 800 });
    await vcPage.goto(`${baseUrl}?demo=1`);
    await vcPage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
    if (await vcPage.evaluate(() => app.engine.context.state !== 'running')) await vcPage.click('#status');
    check('Key hints name the visconf editor', await vcPage.$$eval('#hud-keys kbd', (keys) => keys.some((key) => key.textContent === 'T')));
    await vcPage.mouse.move(700, 200);
    await vcPage.keyboard.press('t');
    await vcPage.waitForFunction(() => !document.getElementById('visconf').hidden && app.visconfPanel.state.song.title === 'Demo-Beat', { timeout: 5000 }).catch(() => {});
    check('T opens the visconf editor with the song from the player', await vcPage.evaluate(() => !document.getElementById('visconf').hidden && app.visconfPanel.state.song.title === 'Demo-Beat'));
    await vcPage.evaluate(async () => {
      const peaks = Array.from({ length: 12000 }, (_, i) => 80 + ((i * 37) % 120));
      const beats = Array.from({ length: 1200 }, (_, i) => i * 0.5);
      await app.visconfPanel.useAnalysis({ version: 1, source: 'file', duration: 600, waveform: { perSecond: 20, peaks }, drops: [{ time: 100, strength: 1 }], quietParts: [{ start: 200, end: 260 }], quietStarts: [200], beats, bpm: 120 });
      app.visconfPanel.update({}); // redraw
    });
    await sleep(300);
    const drawn = await vcPage.$eval('.vc-canvas', (canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
      return lit / (data.length / 4);
    });
    check('The timeline draws waveform and markers', drawn > 0.3, `${Math.round(drawn * 100)} % of the pixels`);
    const draft = await vcPage.evaluate(() => app.visconfPanel.state.visconf?.cues.map((cue) => [cue.time, cue.transition]));
    check('The first visconf starts as a draft: hard on the drop, soft at the quiet part', JSON.stringify(draft) === '[[100,"cut"],[200,"soft"]]', JSON.stringify(draft));

    const box = await vcPage.$eval('.vc-canvas', (canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width };
    });
    const xAt = (time) => box.left + (time / 600) * box.width;
    const waveY = box.top + 58;
    const cueY = box.top + 122;
    await vcPage.mouse.move(xAt(100), waveY);
    await vcPage.mouse.down();
    await vcPage.mouse.move(xAt(110), waveY, { steps: 5 });
    await vcPage.mouse.move(xAt(120.1), waveY, { steps: 5 });
    await vcPage.mouse.up();
    await sleep(700);
    const dragged = await vcPage.evaluate(async () => {
      const { songMarkers } = await chrome.storage.local.get('songMarkers');
      const saved = Object.values(songMarkers ?? {})[0];
      return { live: app.visconfPanel.state.markers.drops.map(({ time, manual }) => [time, manual]), saved: saved?.drops.map(({ time }) => time) };
    });
    check(
      'Dragging a drop moves it onto the beat, marks it as set by hand and saves it',
      dragged.live.length === 1 && Math.abs(dragged.live[0][0] - 120) < 0.6 && dragged.live[0][0] * 2 === Math.round(dragged.live[0][0] * 2) && dragged.live[0][1] && dragged.saved?.[0] === dragged.live[0][0],
      JSON.stringify(dragged),
    );

    await vcPage.mouse.click(xAt(400), waveY);
    await vcPage.mouse.click(xAt(400), waveY);
    await sleep(200);
    const added = await vcPage.evaluate(() => ({ drops: app.visconfPanel.state.markers.drops.length, selected: app.visconfPanel.state.selected?.kind }));
    await vcPage.keyboard.press('Delete');
    await sleep(200);
    const afterDelete = await vcPage.evaluate(() => app.visconfPanel.state.markers.drops.length);
    check('Double-click adds a drop, Delete removes it again', added.drops === 2 && added.selected === 'drop' && afterDelete === 1, JSON.stringify({ added, afterDelete }));

    await vcPage.mouse.click(xAt(300), cueY);
    await vcPage.mouse.click(xAt(300), cueY);
    await sleep(200);
    const cueCount = await vcPage.evaluate(() => app.visconfPanel.state.visconf.cues.length);
    const inspector = await vcPage.$eval('.vc-inspector', (element) => element.querySelectorAll('select').length);
    check('Double-click in the cue lane adds a change and shows its settings', cueCount === 3 && inspector >= 3, `${cueCount} cues, ${inspector} selects`);

    // Playback: a fixed preset 1.5 s ahead of the playhead must show up on time.
    const target = await vcPage.evaluate(async () => {
      const panel = app.visconfPanel;
      const names = app.active.presetNames;
      const name = names.find((candidate) => candidate !== app.active.presetName && !candidate.includes('FractalDrop'));
      const now = app.player.state.position;
      await panel.loadSong({ title: 'Demo-Beat', artist: 'ButterGlow' });
      const { visconf } = panel.state;
      panel.update({ visconf: { ...visconf, cues: [{ id: 'a', time: now + 1.5, preset: { mode: 'fixed', name }, transition: 'cut', origin: 'manual', label: '' }] } });
      panel.setPlay(true);
      return name;
    });
    await vcPage.waitForFunction((name) => app.active.presetName === name, { timeout: 8000 }, target).catch(() => {});
    const playback = await vcPage.evaluate(() => ({ preset: app.active.presetName, playing: app.visconfPanel.playing }));
    check('A playing plan switches to the planned preset on time', playback.preset === target && playback.playing, JSON.stringify(playback));
    await vcPage.screenshot({ path: 'test-output/visconf.png' });
    await vcPage.evaluate(() => app.visconfPanel.setPlay(false));

    const pickLanguage = (language) => { const select = document.getElementById('hud-language'); select.value = language; select.dispatchEvent(new Event('change', { bubbles: true })); };
    await vcPage.evaluate(pickLanguage, 'de');
    await vcPage.waitForFunction(() => document.querySelector('#visconf .vc-load').textContent === 'Datei laden', { timeout: 5000 }).catch(() => {});
    check('The visconf editor follows the language', await vcPage.$eval('#visconf .vc-load', (button) => button.textContent === 'Datei laden'));
    await vcPage.evaluate(pickLanguage, 'en');
    await vcPage.keyboard.press('Escape');
    check('Escape closes the visconf editor', await vcPage.evaluate(() => document.getElementById('visconf').hidden));
    check('No errors in the visconf editor', vcErrors.length === 0, vcErrors.slice(0, 3).join(' | '));
    await vcPage.evaluate(() => chrome.storage.local.remove(['visconfs', 'songAnalyses', 'songMarkers']));
    await vcPage.close();
  }

  // 4K, also with OS scaling: the image must fill the whole canvas.
  for (const [width, height, scale] of [[3840, 2160, 1], [2560, 1440, 1.5], [1920, 1080, 2]]) {
    const sizePage = await browser.newPage();
    await sizePage.setViewport({ width, height, deviceScaleFactor: scale });
    await sizePage.goto(`${baseUrl}?demo=1`);
    await sizePage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 60000 });
    const milkdropWater = (checked) =>
      sizePage.$eval('#hud-active-settings [data-setting="milkdrop.water"] input', (input, value) => {
        input.checked = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, checked);
    await milkdropWater(true); // Milkdrop starts without water
    await sleep(1500);
    const size = await sizePage.evaluate(() => {
      const canvas = document.querySelector('#stage canvas:not(#water)');
      const gl = canvas.getContext('webgl2');
      return {
        buffer: [canvas.width, canvas.height],
        viewport: [...gl.getParameter(gl.VIEWPORT)].slice(2),
        water: [app.water.canvas.width, app.water.canvas.height],
      };
    });
    check(`Water reflects at full resolution at scale ${scale}`, size.water.join() === '3840,2160', size.water.join('x'));
    check(
      `Milkdrop fills 4K at ${width}x${height} with scale ${scale}`,
      size.buffer.join() === '3840,2160' && size.viewport.join() === '3840,2160',
      JSON.stringify(size),
    );
    await milkdropWater(false);
    await sleep(500); // the setting is saved with a short delay
    await sizePage.close();
  }

  // Equalizer: UI, effect on the sound and persistent storage.
  await page.keyboard.press('e');
  check('Key E opens the equalizer', await page.$eval('#equalizer', (panel) => !panel.hidden));
  const sliderHandles = await page.$$('#eq-sliders input');
  check('Equalizer has 10 sliders', sliderHandles.length === 10);
  const sliderBox = await sliderHandles[5].boundingBox();
  await page.mouse.click(sliderBox.x + sliderBox.width / 2, sliderBox.y + 6);
  const sliderTop = await page.evaluate(() => app.engine.eqGains[5]);
  await page.mouse.click(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height - 6);
  const sliderBottom = await page.evaluate(() => app.engine.eqGains[5]);
  check('Slider at the top boosts, at the bottom cuts', sliderTop === 12 && sliderBottom === -12, `${sliderTop} / ${sliderBottom}`);
  await page.$eval('#eq-presets button[data-preset="voice"]', (button) => button.click());
  const setBass = (value) =>
    page.$eval(
      '#eq-bass input',
      (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  await setBass(60);
  await sleep(500);
  const bassCurve = await page.evaluate(() => {
    const frequencies = Float32Array.from([40, 1000]);
    const response = new Float32Array(2);
    app.engine.getEqResponse(frequencies, response);
    return { boost: app.engine.bassBoost, at40: +response[0].toFixed(1), label: document.querySelector('#eq-bass output').textContent };
  });
  check('Bass boost slider works and shows in the curve', bassCurve.boost === 0.6 && bassCurve.label === '60 %' && bassCurve.at40 > 4, JSON.stringify(bassCurve));
  await page.screenshot({ path: 'test-output/equalizer.png' });

  await page.reload();
  await page.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
  const restored = await page.evaluate(() => app.engine.eqGains);
  const restoredBass = await page.evaluate(() => app.engine.bassBoost);
  check('Settings survive reloading, including bass boost', restored[5] === 4 && restored[0] === -3 && restoredBass === 0.6, `${restored.join(' ')} · Bass ${restoredBass}`);
  await page.keyboard.press('e');
  await page.click('#eq-enabled');
  await sleep(200);
  // Checked directly on the frequency response; the beat level fluctuates too much for this.
  const bypass = await page.evaluate(() => {
    const frequencies = Float32Array.from({ length: 64 }, (_, i) => 20 * 1000 ** (i / 63));
    const response = new Float32Array(64);
    app.engine.getEqResponse(frequencies, response);
    return { maxDb: Math.max(...response.map(Math.abs)), limiter: app.engine.limitedPath.gain.value };
  });
  check('Off switch cancels the effect', bypass.maxDb < 0.1 && bypass.limiter < 0.01, JSON.stringify(bypass));
  await page.$eval('#eq-presets button[data-preset="neutral"]', (button) => button.click());
  await setBass(0);
  await page.click('#eq-enabled');
  await sleep(500);

  // The real path through Web Audio: the demo beat has a known pattern that must be detected.
  for (const bpm of [120, 128]) {
    const beatPage = await browser.newPage();
    await beatPage.setViewport({ width: 800, height: 450 });
    await beatPage.goto(`${baseUrl}?demo=1&bpm=${bpm}`);
    await beatPage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
    await beatPage.keyboard.press('v');
    await beatPage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Neon Ring');
    const seconds = 16;
    const result = await beatPage.evaluate(async (seconds) => {
      const counts = { kick: 0, snare: 0, hat: 0, frames: 0 };
      const original = app.engine.beats.update.bind(app.engine.beats);
      let state;
      app.engine.beats.update = (...args) => {
        state = original(...args);
        counts.frames++;
        for (const band of ['kick', 'snare', 'hat']) if (state[band].hit) counts[band]++;
        return state;
      };
      await new Promise((done) => setTimeout(done, seconds * 1000));
      return { ...counts, bpm: state.bpm };
    }, seconds);
    const beats = (seconds * bpm) / 60;
    const near = (actual, expected) => Math.abs(actual - expected) <= expected * 0.15;
    const summary = JSON.stringify({ ...result, fps: Math.round(result.frames / seconds) });
    check(`Kick at ${bpm} BPM`, near(result.kick, beats), summary);
    check(`Snare at ${bpm} BPM`, near(result.snare, beats / 2));
    check(`Hi-hat at ${bpm} BPM`, near(result.hat, beats), `${result.hat} instead of ${beats}`);
    check(`Tempo at ${bpm} BPM`, result.bpm !== null && Math.abs(result.bpm - bpm) <= 2);
    await beatPage.screenshot({ path: `test-output/neon-beat-${bpm}.png` });
    await beatPage.close();
  }

  // A dense mix with a syncopated kick, closer to real music. Here the tempo matters most.
  for (const bpm of [96, 128]) {
    const densePage = await browser.newPage();
    await densePage.setViewport({ width: 800, height: 450 });
    await densePage.goto(`${baseUrl}?demo=1&dense=1&bpm=${bpm}`);
    await densePage.waitForFunction(() => document.getElementById('hud-title').textContent === 'Milkdrop', { timeout: 30000 });
    await densePage.keyboard.press('v');
    await sleep(18000);
    const estimated = await densePage.evaluate(() => app.engine.beats.tempo.bpm);
    check(`Tempo in the dense mix at ${bpm} BPM`, estimated !== null && Math.abs(estimated - bpm) <= 2, `${estimated}`);
    await densePage.close();
  }

  await page.close();

  // Tab capture: a test page plays a tone that must arrive in the audio chain.
  const server = createServer((_, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<body style="height:100vh"><script>
      document.body.onclick = () => {
        const context = new AudioContext();
        const osc = context.createOscillator();
        window.level = context.createGain();
        window.level.gain.value = 0.1;
        osc.frequency.value = 110;
        osc.connect(window.level).connect(context.destination);
        osc.start();
      };
    </script>`);
  }).listen(0);
  const music = await browser.newPage();
  await music.goto(`http://localhost:${server.address().port}`);
  await music.bringToFront();
  await music.click('body');

  const windowsBefore = await worker.evaluate(() => chrome.windows.getAll().then((all) => all.length));
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab);
  });

  const target = await browser.waitForTarget((candidate) => candidate.url().includes('streamId=') || candidate.url().includes('error='), { timeout: 10000 });
  check('Click opens the visualizer window', true, `(${windowsBefore} windows before)`);
  check('Stream ID was granted', target.url().includes('streamId='), decodeURIComponent(target.url().split('?')[1]));

  const visualizerPage = await target.asPage();
  const captureErrors = collectErrors(visualizerPage);
  await sleep(3000);
  const capture = await visualizerPage.evaluate(() => {
    const frame = app.engine.readFrame();
    return {
      state: app.engine.context.state,
      track: app.engine.stream?.getAudioTracks()[0]?.readyState,
      muted: app.engine.stream?.getAudioTracks()[0]?.muted,
      bass: frame.bass,
      status: document.getElementById('status').hidden ? '' : document.getElementById('status').textContent,
    };
  });
  check('Tab audio arrives in the audio chain', capture.bass > 0, JSON.stringify(capture));
  check('Capture runs without errors', captureErrors.length === 0, captureErrors.slice(0, 3).join(' | '));

  // Equalizer with a real 110 Hz tone through the whole chain, measured at the output.
  const measureOutput = (gains, bass = 0) =>
    visualizerPage.evaluate(async (gains, bass) => {
      app.engine.setEqEnabled(true);
      app.engine.setEqGains(gains);
      await app.engine.bassMakeupReady;
      app.engine.setBassBoost(bass);
      await new Promise((done) => setTimeout(done, 500));
      const analyser = app.engine.context.createAnalyser();
      analyser.fftSize = 2048;
      app.engine.master.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let power = 0;
      let peak = 0;
      for (let i = 0; i < 20; i++) {
        await new Promise((done) => setTimeout(done, 50));
        analyser.getFloatTimeDomainData(data);
        for (const sample of data) {
          power += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      app.engine.master.disconnect(analyser);
      return { db: 10 * Math.log10(power / (20 * data.length)), peak };
    }, gains, bass);
  const bandGains = (index, decibels) => Array.from({ length: 10 }, (_, i) => (i === index ? decibels : 0));

  const neutral = await measureOutput(bandGains(0, 0));
  const boost31 = await measureOutput(bandGains(0, 12));
  const boost1k = await measureOutput(bandGains(5, 12));
  const boost125 = await measureOutput(bandGains(2, 12));
  const cut125 = await measureOutput(bandGains(2, -12));
  const change = (result) => (result.db - neutral.db).toFixed(1);
  check('+12 dB at 31 Hz does not make the tone quieter', boost31.db - neutral.db > -1, `${change(boost31)} dB`);
  check('+12 dB at 1 kHz leaves the tone unchanged', Math.abs(boost1k.db - neutral.db) < 1.5, `${change(boost1k)} dB`);
  check('+12 dB at 125 Hz makes the tone louder', boost125.db - neutral.db > 6, `${change(boost125)} dB`);
  check('-12 dB at 125 Hz makes the tone quieter', cut125.db - neutral.db < -6, `${change(cut125)} dB`);
  const bassFull = await measureOutput(bandGains(0, 0), 1);
  check('Full bass boost makes the 110 Hz tone louder', bassFull.db - neutral.db > 3, `${change(bassFull)} dB`);

  await music.evaluate(() => window.level.gain.setValueAtTime(0.9, 0));
  const loud = await measureOutput(bandGains(2, 12));
  check('Limiter catches a loud boost, nothing above 1.0', loud.peak < 1, `peak ${loud.peak.toFixed(2)}`);
  const loudBass = await measureOutput(bandGains(0, 0), 1);
  check('Full bass boost with a loud tone: nothing above 1.0', loudBass.peak < 1, `peak ${loudBass.peak.toFixed(2)}`);
  await measureOutput(bandGains(0, 0), 0);
  server.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAlles in Ordnung');

// Tests the media player with a real music page: title, play/pause, next, previous, seeking, position, hiding.
// Chrome only grants tab control (activeTab) on a real click on the icon. There is none in the test,
// so a copy of the extension runs that may control localhost permanently. For the page this is equivalent.
// No sound reaches the speakers: --disable-audio-output.
import { createHash } from 'node:crypto';
import { cpSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const cache = join(homedir(), '.cache/puppeteer');
const executablePath = process.env.CHROME_PATH ?? join(cache, globSync('chrome/*/*/chrome', { cwd: cache })[0]);
const extensionPath = resolve('test-output/player-extension');
rmSync(extensionPath, { recursive: true, force: true });
mkdirSync('test-output', { recursive: true });
cpSync('dist', extensionPath, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://localhost/*'];
writeFileSync(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const extensionId = [...createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

const failures = [];
function check(name, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  if (!passed) failures.push(name);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Music page: a quiet 60 s tone as <audio>, title via the Media Session, buttons "Next" and "Previous".
const COVER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const server = createServer((request, response) => {
  if (request.url === '/cover.png') {
    response.setHeader('content-type', 'image/png');
    response.end(COVER);
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><body style="height:100vh">
    <button aria-label="Previous" onclick="window.previousCount++">‹</button>
    <button aria-label="Next" onclick="window.nextCount++">›</button>
    <script>
      window.nextCount = 0;
      window.previousCount = 0;
      const rate = 8000;
      const samples = rate * 60;
      const data = new DataView(new ArrayBuffer(44 + samples * 2));
      const text = (offset, value) => [...value].forEach((char, i) => data.setUint8(offset + i, char.charCodeAt(0)));
      text(0, 'RIFF'); data.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt ');
      data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
      data.setUint32(24, rate, true); data.setUint32(28, rate * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
      text(36, 'data'); data.setUint32(40, samples * 2, true);
      for (let i = 0; i < samples; i++) data.setInt16(44 + i * 2, Math.sin(i * 0.2) * 3000, true);
      window.audio = new Audio(URL.createObjectURL(new Blob([data], { type: 'audio/wav' })));
      document.body.append(audio);
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Test song', artist: 'Test band', artwork: [{ src: '/cover.png' }] });
      // As on some real sites, the audio is not attached to the page and reports its state via the Media Session.
      audio.onplay = () => (navigator.mediaSession.playbackState = 'playing');
      audio.onpause = () => (navigator.mediaSession.playbackState = 'paused');
      document.body.onclick = () => audio.play();
    </script>`);
}).listen(0);

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    `--allowlisted-extension-id=${extensionId}`,
    '--disable-audio-output',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  ignoreDefaultArgs: ['--disable-extensions', '--mute-audio'],
});

try {
  const worker = await (await browser.waitForTarget((target) => target.type() === 'service_worker')).worker();
  const music = await browser.newPage();
  await music.goto(`http://localhost:${server.address().port}`);
  await music.bringToFront();
  await music.mouse.click(400, 300);
  await sleep(500);
  check('Music page plays', await music.evaluate(() => !audio.paused));

  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    chrome.action.onClicked.dispatch(tab);
  });
  const target = await browser.waitForTarget((candidate) => candidate.url().includes('streamId='), { timeout: 10000 });
  const page = await target.asPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 720 });
  await page.waitForFunction(() => document.querySelector('.player-title')?.textContent === 'Test song', { timeout: 15000 });
  const shown = await page.evaluate(() => ({
    title: document.querySelector('.player-title').textContent,
    artist: document.querySelector('.player-artist').textContent,
    cover: document.querySelector('.player-cover').style.backgroundImage,
    playing: document.getElementById('player').classList.contains('playing'),
    next: !document.querySelector('[data-command="next"]').disabled,
  }));
  check('Player shows title, artist and cover', shown.artist === 'Test band' && shown.cover.includes('/cover.png'), JSON.stringify(shown));
  check('Player detects that music is playing and finds "Next"', shown.playing && shown.next);

  const click = async (command) => {
    await page.mouse.move(640, 300);
    await page.click(`[data-command="${command}"]`);
    await sleep(800);
  };
  await click('toggle');
  check('Pause stops the music in the tab', await music.evaluate(() => audio.paused));
  check('Button then shows Play', await page.evaluate(() => !document.getElementById('player').classList.contains('playing')));
  await page.mouse.move(600, 200);
  await page.keyboard.press('Space');
  await sleep(800);
  check('Space bar plays again', await music.evaluate(() => !audio.paused));
  await click('next');
  await click('previous');
  check('Next and Previous press the page buttons', await music.evaluate(() => window.nextCount === 1 && window.previousCount === 1));

  await page.$eval('.player-progress', (input) => {
    input.value = '500';
    input.dispatchEvent(new Event('change'));
  });
  await sleep(800);
  const position = await music.evaluate(() => audio.currentTime);
  check('Progress bar seeks in the tab', Math.abs(position - 30) < 2, `${position.toFixed(1)} s`);

  // Visconf editor: "Record current song" starts the song in the tab from the beginning; Repeat starts it again at the end.
  await page.mouse.move(640, 300);
  await page.keyboard.press('t');
  await page.waitForFunction(() => !document.getElementById('visconf').hidden, { timeout: 5000 });
  await music.evaluate(() => audio.pause());
  await sleep(1200);
  await page.click('#visconf .vc-record');
  await sleep(1500);
  const recordStart = { tab: await music.evaluate(() => ({ position: audio.currentTime, playing: !audio.paused })), recording: await page.evaluate(() => app.visconfPanel.recording) };
  check('"Record current song" plays the song in the tab from the start and records', recordStart.recording && recordStart.tab.playing && recordStart.tab.position < 4, JSON.stringify(recordStart));
  await page.click('#visconf .vc-record');
  await sleep(300);
  await page.click('#visconf .vc-repeat input');
  await music.evaluate(() => (audio.currentTime = 58.5));
  await music.waitForFunction(() => audio.currentTime < 6 && !audio.paused, { timeout: 10000 }).catch(() => {});
  const repeated = await music.evaluate(() => ({ position: audio.currentTime, playing: !audio.paused }));
  check('Repeat starts the song again at its end', repeated.playing && repeated.position < 6, JSON.stringify(repeated));
  await page.click('#visconf .vc-repeat input');
  // The open editor follows when the tab moves on to another song.
  const songBefore = await page.evaluate(() => app.visconfPanel.state.song.title);
  await music.evaluate(() => (navigator.mediaSession.metadata = new MediaMetadata({ title: 'Second song', artist: 'Test band' })));
  await page.waitForFunction(() => app.visconfPanel.state.song.title === 'Second song', { timeout: 8000 }).catch(() => {});
  const songAfter = await page.evaluate(() => ({ title: app.visconfPanel.state.song.title, field: document.querySelector('#visconf .vc-title').value }));
  check('The open editor switches to the next song in the tab', songBefore === 'Test song' && songAfter.title === 'Second song' && songAfter.field === 'Second song', JSON.stringify({ songBefore, songAfter }));
  await music.evaluate(() => (navigator.mediaSession.metadata = new MediaMetadata({ title: 'Test song', artist: 'Test band', artwork: [{ src: '/cover.png' }] })));
  await page.keyboard.press('Escape');
  await page.evaluate(() => chrome.storage.local.remove(['visconfs', 'songAnalyses', 'songMarkers', 'visconfRepeat']));

  // Position: bottom centre by default, changeable in the menu and saved.
  const box = () =>
    page.$eval('#player', (player) => {
      const rect = player.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(innerWidth - rect.right), top: Math.round(rect.top), bottom: Math.round(innerHeight - rect.bottom) };
    });
  // At 1280 px width, bottom centre would be too tight next to the overlay; there the player moves to the bottom right.
  const narrow = await box();
  check('Bottom on a narrow screen: bottom right, without covering the overlay', narrow.bottom === 24 && narrow.right === 24, JSON.stringify(narrow));
  await page.screenshot({ path: 'test-output/player-bottom-narrow.png' });
  await page.setViewport({ width: 1920, height: 1080 });
  await sleep(300);
  const bottom = await box();
  check('Bottom on a wide screen: centred', bottom.bottom === 24 && Math.abs(bottom.left - bottom.right) <= 1, JSON.stringify(bottom));
  await page.screenshot({ path: 'test-output/player-bottom.png' });
  await page.setViewport({ width: 1280, height: 720 });
  await sleep(300);
  await page.click('#hud-menu-toggle');
  const select = await page.$$eval('#hud-shared-settings select', (selects) =>
    selects.findIndex((element) => [...element.options].some((option) => option.value === 'right')),
  );
  const selects = await page.$$('#hud-shared-settings select');
  await selects[select].select('right');
  await sleep(300);
  const right = await box();
  check('Position right from the menu', right.right === 24 && Math.abs(right.top - right.bottom) <= 1, JSON.stringify(right));
  for (const name of ['top', 'left', 'center']) {
    await selects[select].select(name);
    await sleep(200);
    await page.screenshot({ path: `test-output/player-${name}.png` });
  }
  const center = await box();
  check('Position centre', Math.abs(center.left - center.right) <= 1 && Math.abs(center.top - center.bottom) <= 1, JSON.stringify(center));
  await selects[select].select('bottom');
  await page.click('#hud-menu-toggle');

  // Without mouse movement the player disappears. It has its own pin, independent of the menu pin.
  const idleState = () =>
    page.evaluate(() => ({
      player: getComputedStyle(document.getElementById('player')).opacity,
      hud: getComputedStyle(document.getElementById('hud')).opacity,
      playerPinned: document.getElementById('player').classList.contains('pinned'),
      hudPinned: document.getElementById('hud').classList.contains('pinned'),
      idle: document.body.classList.contains('idle'),
    }));
  await page.mouse.move(640, 320);
  await sleep(3800);
  check('Player disappears without mouse movement', (await idleState()).player === '0');

  await page.mouse.move(650, 320);
  await page.click('#hud-pin');
  await page.mouse.move(660, 320);
  await sleep(4300);
  const menuOnly = await idleState();
  check('The menu pin does not keep the player', menuOnly.hudPinned && menuOnly.idle && menuOnly.player === '0', JSON.stringify(menuOnly));
  await page.mouse.move(650, 320);
  await page.click('#hud-pin');

  await page.click('.player-pin');
  await page.mouse.move(660, 320);
  await sleep(4300);
  const playerOnly = await idleState();
  check('Its own pin keeps the player; the menu still disappears', playerOnly.playerPinned && !playerOnly.hudPinned && playerOnly.idle && playerOnly.player === '1' && playerOnly.hud === '0', JSON.stringify(playerOnly));
  const pinIcon = await page.$eval('.player-pin', (pin) => getComputedStyle(pin).opacity);
  check('The player pin icon still disappears', pinIcon === '0');

  // The tab reports playback, but only silence arrives (music in an app, copy protection). Volume 0 produces exactly that.
  await music.evaluate(async () => {
    audio.loop = true;
    audio.currentTime = 1;
    audio.volume = 0;
    await audio.play();
  });
  const statusShown = () =>
    page.evaluate(() => {
      const status = document.getElementById('status');
      return { hidden: status.hidden, text: status.textContent };
    });
  await page.waitForFunction(() => !document.getElementById('status').hidden, { timeout: 15000 }).catch(() => {});
  const silentHint = await statusShown();
  await music.evaluate(() => (audio.volume = 1));
  await page.waitForFunction(() => document.getElementById('status').hidden, { timeout: 5000 }).catch(() => {});
  const afterSound = await statusShown();
  check(
    'A playing tab that delivers only silence gets a hint, which goes away with sound',
    !silentHint.hidden && silentHint.text.includes('only silence') && afterSound.hidden,
    JSON.stringify({ silentHint, afterSound }),
  );

  // The stream ID is only valid once, so a new window in demo mode checks whether the pin was saved.
  const demo = await browser.newPage();
  await demo.goto(`chrome-extension://${extensionId}/visualizer.html?demo=1`, { timeout: 15000 });
  const restored = await demo
    .waitForFunction(() => document.getElementById('player')?.classList.contains('pinned'), { timeout: 10000 })
    .then(() => true, () => false);
  check('Player pin survives reloading', restored);
  await demo.close();

  check('No errors in the visualizer', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('Player OK');

// Small media player: glass box with title, cover, next, previous, play/pause and progress.
// Controls the captured tab. In demo mode it controls the demo beat.
import { onLanguageChange, t } from '../i18n/i18n.js';
import { mediaControl } from './media-control.js';

export const playerSettings = [
  { id: 'enabled', label: 'settings.player.enabled', type: 'toggle', default: true },
  {
    id: 'position',
    label: 'settings.player.position',
    type: 'select',
    default: 'bottom',
    options: [
      { value: 'bottom', label: 'settings.player.bottom' },
      { value: 'top', label: 'settings.player.top' },
      { value: 'left', label: 'settings.player.left' },
      { value: 'right', label: 'settings.player.right' },
      { value: 'center', label: 'settings.player.center' },
    ],
  },
];

const PIN_KEY = 'playerPinned';
const POLL_MS = 1000;
const AFTER_COMMAND_MS = 350;
const POSITIONS = ['bottom', 'top', 'left', 'right', 'center'];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Control of a real tab. Chrome allows this for exactly this tab after the click on the icon (activeTab).
export function createTabController(tabId) {
  return {
    async send(command, value = 0) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: mediaControl,
          args: [command, value],
        });
        return result?.result ?? { unavailable: 'player.noAnswer' };
      } catch (error) {
        // After navigating to another page in the tab, Chrome takes the access back. A click on the icon gives it again.
        return { unavailable: 'player.noControl', error: error.message };
      }
    },
  };
}

// Control of the demo beat: play/pause stops the sound; there is no next or previous.
export function createDemoController(context) {
  return {
    async send(command) {
      if (command === 'toggle') {
        if (context.state === 'running') await context.suspend();
        else await context.resume();
      } else if (command === 'play') await context.resume();
      else if (command === 'pause') await context.suspend();
      return {
        title: 'Demo-Beat',
        artist: 'ButterGlow',
        artwork: '',
        playing: context.state === 'running',
        position: context.currentTime,
        duration: 0,
        canNext: false,
        canPrevious: false,
        canSeek: false,
      };
    },
  };
}

// `volume`: { get(), set(percent), watch(listener) } for the extension's own volume (the audio setting), so the
// slider here and the one in the menu always show the same value.
export function createPlayer({ root, controller, settings, volume = null, needsState = () => false }) {
  const cover = root.querySelector('.player-cover');
  const title = root.querySelector('.player-title');
  const artist = root.querySelector('.player-artist');
  const previousButton = root.querySelector('[data-command="previous"]');
  const toggleButton = root.querySelector('[data-command="toggle"]');
  const nextButton = root.querySelector('[data-command="next"]');
  const progress = root.querySelector('.player-progress');
  const elapsed = root.querySelector('.player-elapsed');
  const total = root.querySelector('.player-total');
  const message = root.querySelector('.player-message');
  const pinButton = root.querySelector('.player-pin');

  // Its own pin, independent of the menu pin. When pinned, the player stays visible even without mouse movement.
  let pinned = false;
  function applyPin() {
    root.classList.toggle('pinned', pinned);
    pinButton.setAttribute('aria-pressed', String(pinned));
    pinButton.title = t(pinned ? 'player.unpin' : 'player.pinTitle');
  }
  pinButton.addEventListener('click', () => {
    pinned = !pinned;
    applyPin();
    chrome.storage.local.set({ [PIN_KEY]: pinned });
  });
  chrome.storage.local.get(PIN_KEY).then(({ [PIN_KEY]: saved }) => {
    pinned = saved === true;
    applyPin();
  });

  let state = null;
  onLanguageChange(() => {
    applyPin();
    if (state) show(state);
  });
  let pollTimer = null;
  let seeking = false;
  let busy = false;

  function show(next) {
    state = next;
    const unavailable = Boolean(next.unavailable);
    root.classList.toggle('unavailable', unavailable);
    message.hidden = !unavailable;
    message.textContent = next.unavailable ? t(next.unavailable) : '';
    if (unavailable) return;

    title.textContent = next.title || t('player.unknownTitle');
    title.title = next.title;
    artist.textContent = next.artist;
    artist.hidden = !next.artist;
    if (next.artwork) cover.style.backgroundImage = `url("${next.artwork.replace(/"/g, '%22')}")`;
    else cover.style.removeProperty('background-image');
    cover.classList.toggle('empty', !next.artwork);

    root.classList.toggle('playing', next.playing);
    toggleButton.setAttribute('aria-label', t(next.playing ? 'player.pause' : 'player.play'));
    toggleButton.title = t(next.playing ? 'player.pauseKey' : 'player.playKey');
    previousButton.disabled = !next.canPrevious;
    nextButton.disabled = !next.canNext;

    progress.disabled = !next.canSeek;
    root.classList.toggle('no-progress', !next.canSeek);
    if (!seeking && next.canSeek) progress.value = String(Math.round((next.position / next.duration) * 1000));
    elapsed.textContent = formatTime(next.position);
    total.textContent = formatTime(next.duration);
  }

  async function send(command, value) {
    if (busy && command === 'state') return;
    busy = true;
    try {
      show(await controller.send(command, value));
      if (command !== 'state') {
        await new Promise((done) => setTimeout(done, AFTER_COMMAND_MS));
        show(await controller.send('state'));
      }
    } finally {
      busy = false;
    }
  }

  function applySettings() {
    root.hidden = !settings.enabled;
    const position = POSITIONS.includes(settings.position) ? settings.position : 'bottom';
    for (const name of POSITIONS) root.classList.toggle(`at-${name}`, name === position);
    clearInterval(pollTimer);
    // Hidden, the player keeps polling only while someone needs the state (the visconf editor).
    pollTimer = setInterval(() => {
      if (settings.enabled || needsState()) send('state');
    }, POLL_MS);
    if (settings.enabled || needsState()) send('state');
  }

  for (const button of [previousButton, toggleButton, nextButton]) {
    button.addEventListener('click', () => send(button.dataset.command));
  }
  progress.addEventListener('input', () => {
    seeking = true;
    if (state?.duration) elapsed.textContent = formatTime((Number(progress.value) / 1000) * state.duration);
  });
  progress.addEventListener('change', () => {
    seeking = false;
    send('seek', Number(progress.value) / 1000);
  });

  // Volume: the same value as "Volume" in the menu. The speaker mutes and brings the previous level back.
  const volumeRow = root.querySelector('.player-volume-row');
  const volumeInput = root.querySelector('.player-volume');
  const volumeValue = root.querySelector('.player-volume-value');
  const muteButton = root.querySelector('.player-mute');
  let beforeMute = 100;
  function showVolume(percent) {
    volumeInput.value = String(percent);
    volumeValue.textContent = `${percent} %`;
    muteButton.setAttribute('aria-pressed', String(percent === 0));
    muteButton.title = t(percent === 0 ? 'player.unmute' : 'player.mute');
    muteButton.setAttribute('aria-label', muteButton.title);
  }
  if (volume) {
    showVolume(volume.get());
    volume.watch((audio) => showVolume(audio.volume));
    volumeInput.addEventListener('input', () => volume.set(Number(volumeInput.value)));
    muteButton.addEventListener('click', () => {
      const current = volume.get();
      if (current > 0) beforeMute = current;
      volume.set(current > 0 ? 0 : beforeMute || 100);
    });
    // Arrow keys on the slider change the volume, not the preset.
    volumeInput.addEventListener('keydown', (event) => event.stopPropagation());
    onLanguageChange(() => showVolume(volume.get()));
  } else volumeRow.hidden = true;

  applySettings();

  return {
    get state() {
      return state;
    },
    get pinned() {
      return pinned;
    },
    toggle: () => send('toggle'),
    play: () => send('play'),
    pause: () => send('pause'),
    // `fraction` 0 to 1 of the track, like the progress bar.
    seek: (fraction) => send('seek', fraction),
    // Call after a change in the menu.
    applySettings,
  };
}

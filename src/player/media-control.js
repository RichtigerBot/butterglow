// Runs in the captured tab (via chrome.scripting, in the page's world) and must therefore stand on its own:
// no imports, no variables from outside. Runs a command and returns the current state.
//
// Commands: 'state' (read only), 'toggle', 'next', 'previous', 'seek' (value: 0 to 1)
export function mediaControl(command, value) {
  // Known sites first, then general labels. Order matters: the first match wins.
  const BUTTONS = {
    next: [
      'ytmusic-player-bar .next-button',
      '.ytp-next-button',
      '[data-testid="control-button-skip-forward"]',
      '.skipControl__next',
    ],
    previous: [
      'ytmusic-player-bar .previous-button',
      '.ytp-prev-button',
      '[data-testid="control-button-skip-back"]',
      '.skipControl__previous',
    ],
    toggle: ['ytmusic-player-bar #play-pause-button', '[data-testid="control-button-playpause"]', '.playControl'],
  };
  const LABELS = {
    next: /^(next|nächste|nächster|weiter|skip forward|vorwärts)/i,
    previous: /^(previous|prev|vorherige|vorheriger|zurück|skip back)/i,
  };

  const visible = (element) => element && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && element.getClientRects().length > 0;

  function findButton(kind) {
    for (const selector of BUTTONS[kind] ?? []) {
      const element = document.querySelector(selector);
      if (visible(element)) return element;
    }
    if (!LABELS[kind]) return null;
    for (const element of document.querySelectorAll('button, [role="button"]')) {
      const label = (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
      if (LABELS[kind].test(label) && visible(element)) return element;
    }
    return null;
  }

  // Some sites play through an Audio object that is not attached to the page. We remember such media
  // as soon as they play (from the first command on). Anything that was playing before is found on the next start;
  // until then the playback state of the Media Session helps.
  if (!window.__equalizerMedia) {
    const known = new Set();
    window.__equalizerMedia = known;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(...args) {
      known.add(this);
      return originalPlay.apply(this, args);
    };
  }

  // The medium that is playing right now, otherwise the longest one. Short clips (ads, previews) count less.
  function findMedia() {
    const candidates = new Set([...document.querySelectorAll('video, audio'), ...window.__equalizerMedia]);
    const all = [...candidates].filter((media) => media.readyState > 0 || media.src || media.currentSrc);
    return all.find((media) => !media.paused) ?? all.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] ?? null;
  }

  const media = findMedia();
  if (command === 'toggle') {
    const button = findButton('toggle');
    if (button) button.click();
    else if (media) {
      if (media.paused) media.play().catch(() => {});
      else media.pause();
    }
  } else if (command === 'next' || command === 'previous') {
    findButton(command)?.click();
  } else if (command === 'seek' && media && Number.isFinite(media.duration) && media.duration > 0) {
    media.currentTime = Math.min(1, Math.max(0, value)) * media.duration;
  }

  const session = navigator.mediaSession;
  const metadata = session?.metadata;
  const artwork = metadata?.artwork?.length ? metadata.artwork[metadata.artwork.length - 1].src : '';
  const playingBySession = session?.playbackState === 'playing' ? true : session?.playbackState === 'paused' ? false : null;
  const duration = media && Number.isFinite(media.duration) ? media.duration : 0;
  return {
    title: metadata?.title || document.title || '',
    artist: metadata?.artist || '',
    artwork: artwork ? new URL(artwork, location.href).href : '',
    // Right after a command the state lags behind briefly. So the player asks again right after.
    playing: media ? !media.paused : (playingBySession ?? false),
    position: media ? media.currentTime : 0,
    duration,
    canNext: Boolean(findButton('next')),
    canPrevious: Boolean(findButton('previous')),
    canSeek: duration > 0,
    site: location.hostname, // for the hint about copy-protected services
  };
}

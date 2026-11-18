// Notices when the captured tab plays but only silence arrives. Services with copy protection (Spotify Web,
// Netflix and others) do that: the capture runs, but Chrome hands over silence instead of their sound.
// Without a hint this looks like a broken extension, so the visualizer explains it.

// Below this peak level the input counts as silence. Protected sound arrives as exact zeros; real music,
// even a quiet passage, stays clearly above it.
export const SILENCE_PEAK = 1e-4;
// How long it has to stay silent while the tab plays. Long enough for pauses between songs and fade-ins.
export const SILENCE_SECONDS = 8;

// Services known to protect their sound. The name is shown in the hint; matched on the end of the host name.
const PROTECTED_SERVICES = [
  ['spotify.com', 'Spotify'],
  ['netflix.com', 'Netflix'],
  ['disneyplus.com', 'Disney+'],
  ['primevideo.com', 'Prime Video'],
  ['music.amazon.com', 'Amazon Music'],
  ['music.amazon.de', 'Amazon Music'],
  ['music.apple.com', 'Apple Music'],
  ['tidal.com', 'Tidal'],
  ['deezer.com', 'Deezer'],
];

export function protectedServiceName(host) {
  const name = String(host ?? '').toLowerCase();
  const match = PROTECTED_SERVICES.find(([domain]) => name === domain || name.endsWith(`.${domain}`));
  return match ? match[1] : null;
}

// `readPeak()` returns the current peak of the undelayed input, `readTab()` the tab's state from the player
// script ({ playing, site }). `onSilent(service)` gets the service name or null for an unknown site,
// `onSound()` is called when sound arrives again after a hint.
export function createSilenceWatch({ readPeak, readTab, onSilent, onSound, seconds = SILENCE_SECONDS }) {
  let silentSince = null;
  let reported = false;
  let asking = false;

  return {
    // Call about once per second with the time in seconds.
    async check(now) {
      if (readPeak() >= SILENCE_PEAK) {
        silentSince = null;
        if (reported) {
          reported = false;
          onSound();
        }
        return;
      }
      silentSince ??= now;
      // Only ask the tab once the silence lasts; the question runs a script in the tab.
      if (reported || asking || now - silentSince < seconds) return;
      asking = true;
      try {
        const tab = await readTab();
        if (tab?.playing === true) {
          reported = true;
          onSilent(protectedServiceName(tab.site));
        }
      } finally {
        asking = false;
      }
    },
  };
}

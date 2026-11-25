// Preview images of the built-in presets and nicknames for presets.
//
// The images come from previews.json (made by scripts/make-previews.mjs), one small WebP data URL per preset. The
// file is about 2 MB, so it is loaded once, on first use, and shared by the preset browser and the visconf editor.
// Own presets have no image; they get a gradient that stays the same for each name.
//
// A nickname is a short name of one's own for a preset with a long or hard to remember name. It is shown instead of
// the original name (browser, visconf editor, menu), and search finds both.

const PREVIEW_FILE = 'previews.json';
export const NICKNAMES_KEY = 'presetNicknames';
export const MAX_NICKNAME_LENGTH = 40;

let previewsPromise = null;

// Resolves to { [presetName]: dataUrl }, or {} if the file is missing.
export function loadPreviews() {
  previewsPromise ??= fetch(PREVIEW_FILE)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));
  return previewsPromise;
}

export function placeholderFor(name) {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 35%), hsl(${(hue + 60) % 360} 70% 15%))`;
}

// Value for style.backgroundImage: the preview image, or the placeholder.
export function previewImage(previews, name) {
  const image = previews?.[name];
  return image ? `url(${image})` : placeholderFor(name);
}

export function cleanNicknames(stored) {
  const result = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result;
  for (const [name, nickname] of Object.entries(stored)) {
    const clean = typeof nickname === 'string' ? nickname.trim().slice(0, MAX_NICKNAME_LENGTH) : '';
    if (name && clean) result[name] = clean;
  }
  return result;
}

export function createNicknames({ storage = globalThis.chrome?.storage?.local } = {}) {
  let nicknames = {};
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const ready = Promise.resolve(storage?.get(NICKNAMES_KEY))
    .then((stored) => {
      nicknames = cleanNicknames(stored?.[NICKNAMES_KEY]);
      notify();
    })
    .catch(() => {});

  return {
    ready,
    get: (name) => nicknames[name] ?? '',
    // What is shown for a preset: its nickname, or else its name.
    display: (name) => nicknames[name] || name,
    matches: (name, query) => name.toLowerCase().includes(query) || Boolean(nicknames[name]?.toLowerCase().includes(query)),
    // An empty nickname removes it.
    set(name, nickname) {
      const clean = String(nickname ?? '').trim().slice(0, MAX_NICKNAME_LENGTH);
      if ((nicknames[name] ?? '') === clean) return;
      const next = { ...nicknames };
      if (clean) next[name] = clean;
      else delete next[name];
      nicknames = next;
      Promise.resolve(storage?.set({ [NICKNAMES_KEY]: nicknames })).catch(() => {});
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

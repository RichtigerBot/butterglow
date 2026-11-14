// Translations for the user interface. English and German, chosen automatically from the browser language or
// explicitly in the menu. Switching takes effect immediately: modules re-render via onLanguageChange.
//
// Texts live in en.js and de.js as nested objects; keys are dotted paths ('editor.save').
// Placeholders are written as {name} and filled from the second argument of t().
import de from './de.js';
import en from './en.js';

export const LANGUAGES = ['en', 'de'];
const TABLES = { en, de };
const STORAGE_KEY = 'language';

let preference = 'auto';
let language = detect();
const listeners = new Set();

function detect(browserLanguage = globalThis.navigator?.language) {
  return String(browserLanguage ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

// 'auto' follows the browser; anything else must be one of LANGUAGES.
export function resolveLanguage(choice, browserLanguage) {
  return LANGUAGES.includes(choice) ? choice : detect(browserLanguage);
}

function lookup(table, key) {
  let node = table;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

// Missing in the current language: English. Missing there too: the key itself, so the gap is visible.
export function t(key, vars) {
  let text = lookup(TABLES[language], key);
  if (typeof text !== 'string') text = lookup(en, key);
  if (typeof text !== 'string') return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

export function getLanguage() {
  return language;
}

export function getLanguagePreference() {
  return preference;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// `choice`: 'auto', 'en' or 'de'. Listeners only run when the effective language changes.
export function setLanguage(choice, { save = true } = {}) {
  preference = LANGUAGES.includes(choice) ? choice : 'auto';
  if (save) globalThis.chrome?.storage?.local.set({ [STORAGE_KEY]: preference });
  const next = resolveLanguage(preference);
  if (next === language) return;
  language = next;
  if (globalThis.document) document.documentElement.lang = language;
  for (const listener of listeners) listener(language);
}

// Reads the stored choice. Before the first render, so the page never flashes in the wrong language.
export async function loadLanguage() {
  const stored = await globalThis.chrome?.storage?.local.get(STORAGE_KEY);
  setLanguage(stored?.[STORAGE_KEY] ?? 'auto', { save: false });
  if (globalThis.document) document.documentElement.lang = language;
}

// Static texts in HTML: data-i18n="key" sets the text, data-i18n-title / -aria-label / -placeholder set attributes.
const ATTRIBUTES = ['title', 'aria-label', 'placeholder'];
export function translateDom(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ATTRIBUTES) {
    const data = `data-i18n-${attribute}`;
    for (const element of root.querySelectorAll(`[${data}]`)) element.setAttribute(attribute, t(element.getAttribute(data)));
  }
}

// Only for tests: switch without storage.
export function setLanguageForTest(choice) {
  setLanguage(choice, { save: false });
}

// Settings menu in the overlay at the bottom left: expands upwards and can be pinned.
// It is built from descriptions that visualizers and effects bring along themselves:
//   { id, label, type: 'range' | 'toggle' | 'select', default, min, max, step, unit, options: [{ value, label }] }
// `label` is a translation key (see i18n/) or a function returning the text.
import { getLanguagePreference, onLanguageChange, setLanguage, t } from '../i18n/i18n.js';

const STORAGE_KEY = 'hud';
const SAVE_DELAY_MS = 300;

export function defaultsOf(schema) {
  return Object.fromEntries(schema.map(({ id, default: value }) => [id, value]));
}

function isValid(field, value) {
  if (field.type === 'toggle') return typeof value === 'boolean';
  if (field.type === 'range') return Number.isFinite(value) && value >= field.min && value <= field.max;
  if (field.custom && Number.isFinite(value) && value >= field.custom.min && value <= field.custom.max) return true;
  return field.options.some((option) => option.value === value);
}

const CUSTOM = 'custom';
const text = (label) => (typeof label === 'function' ? label() : t(label));

function createControl(field, value, onChange) {
  const row = document.createElement('label');
  row.className = `setting setting-${field.type}`;
  const name = document.createElement('span');
  name.textContent = text(field.label);
  row.append(name);

  if (field.type === 'toggle') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input);
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    for (const option of field.options) select.add(new Option(text(option.label), String(option.value)));
    const known = field.options.some((option) => option.value === value);
    // With `custom` there is also "Custom …" and a number field, for example for a custom time in seconds.
    let number = null;
    if (field.custom) {
      select.add(new Option(text(field.custom.label ?? 'settings.custom'), CUSTOM));
      number = document.createElement('input');
      number.type = 'number';
      number.className = 'setting-custom';
      Object.assign(number, { min: field.custom.min, max: field.custom.max, step: field.custom.step ?? 1 });
      number.value = known ? field.custom.default : value;
      number.hidden = known; // transferred to the wrapper below
      number.title = t('settings.range', { min: field.custom.min, max: field.custom.max, unit: field.custom.unit ?? '' });
      number.setAttribute('aria-label', t('settings.customValue', { label: text(field.label), unit: field.custom.unit ?? '' }));
      const commit = () => {
        const clamped = Math.min(field.custom.max, Math.max(field.custom.min, Number(number.value) || field.custom.default));
        if (String(clamped) !== number.value) number.value = clamped;
        onChange(clamped);
      };
      number.addEventListener('change', commit);
      number.addEventListener('keydown', (event) => {
        event.stopPropagation(); // digits and arrows are not keyboard shortcuts
        if (event.key === 'Enter') number.blur();
      });
      select.addEventListener('change', () => {
        if (select.value !== CUSTOM) return;
        commit();
        // Only after all reactions to the selection (show the number field, the select gives up focus).
        setTimeout(() => {
          number.focus();
          number.select();
        });
      });
    }
    select.value = known || !field.custom ? String(value) : CUSTOM;
    select.addEventListener('change', () => {
      if (select.value === CUSTOM) return;
      onChange(field.options.find((option) => String(option.value) === select.value).value);
    });
    row.append(select);
    if (number) {
      // Own row below the select, right-aligned: number and unit.
      const wrap = document.createElement('span');
      wrap.className = 'setting-custom-wrap';
      wrap.hidden = number.hidden;
      number.hidden = false;
      wrap.append(number);
      if (field.custom.unit) wrap.append(Object.assign(document.createElement('span'), { className: 'setting-unit', textContent: field.custom.unit.trim() }));
      row.append(wrap);
      select.addEventListener('change', () => (wrap.hidden = select.value !== CUSTOM));
    }
  } else {
    const output = document.createElement('output');
    const format = (current) => `${current}${field.unit ?? ''}`;
    output.textContent = format(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = field.min;
    input.max = field.max;
    input.step = field.step ?? 1;
    input.value = value;
    input.setAttribute('aria-label', text(field.label));
    input.addEventListener('input', () => {
      output.textContent = format(input.value);
      onChange(Number(input.value));
    });
    row.append(output, input);
  }
  return row;
}

export async function createSettingsPanel({ hud, visualizers, sections, onSelectVisualizer, onPinChange }) {
  const menu = hud.querySelector('#hud-menu');
  const menuToggle = hud.querySelector('#hud-menu-toggle');
  const pinButton = hud.querySelector('#hud-pin');
  const keysButton = hud.querySelector('#hud-keys-toggle');
  const visualizerSelect = hud.querySelector('#hud-visualizer');
  const activeSection = hud.querySelector('#hud-active-settings');
  const sharedSections = hud.querySelector('#hud-shared-settings');

  const { [STORAGE_KEY]: saved } = await chrome.storage.local.get(STORAGE_KEY);
  const values = saved?.values ?? {};
  const state = { pinned: saved?.pinned === true, expanded: saved?.expanded === true, keys: saved?.keys !== false };
  let saveTimer;

  // Sliders save after a short pause, so dragging does not write on every step.
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }
  // Buttons (key hints, pin, menu) save at once: the page may be closed or the extension restarted right after.
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    return chrome.storage.local.set({ [STORAGE_KEY]: { ...state, values } });
  }
  // Whatever is still waiting is written when the page goes away.
  window.addEventListener('pagehide', () => {
    if (saveTimer) saveNow();
  });

  // Returns an object that visualizers and effects read directly. Changes therefore take effect immediately.
  const live = new Map();
  function settingsFor(id, schema) {
    if (live.has(id)) return live.get(id);
    const settings = {};
    for (const field of schema) {
      const stored = values[id]?.[field.id];
      settings[field.id] = isValid(field, stored) ? stored : field.default;
    }
    live.set(id, settings);
    return settings;
  }

  // `onChange` is optional, for parts that need to do more on a change than read the value.
  function renderFields(container, id, schema, onChange) {
    const settings = settingsFor(id, schema);
    for (const field of schema) {
      const row = createControl(field, settings[field.id], (value) => {
        settings[field.id] = value;
        values[id] = { ...values[id], [field.id]: value };
        save();
        onChange?.(settings);
      });
      row.dataset.setting = `${id}.${field.id}`; // fixed name for tests, independent of the language
      container.append(row);
    }
  }

  function applyState() {
    hud.classList.toggle('pinned', state.pinned);
    menu.hidden = !state.expanded;
    menuToggle.setAttribute('aria-expanded', String(state.expanded));
    pinButton.setAttribute('aria-pressed', String(state.pinned));
    pinButton.title = t(state.pinned ? 'hud.pinMenuOff' : 'hud.pinMenuOn');
    hud.classList.toggle('no-keys', !state.keys);
    keysButton.setAttribute('aria-pressed', String(state.keys));
    keysButton.title = t(state.keys ? 'hud.hideKeyHints' : 'hud.showKeyHints');
  }

  keysButton.addEventListener('click', () => {
    state.keys = !state.keys;
    applyState();
    saveNow();
  });

  menuToggle.addEventListener('click', () => {
    state.expanded = !state.expanded;
    applyState();
    saveNow();
  });
  pinButton.addEventListener('click', () => {
    state.pinned = !state.pinned;
    applyState();
    saveNow();
    onPinChange();
  });

  visualizerSelect.addEventListener('change', () => onSelectVisualizer(Number(visualizerSelect.value)));

  // Language: not a schema field, because i18n stores it itself and everything has to re-render when it changes.
  // Each language is named in itself, so it can be found whatever is currently shown.
  function renderLanguage() {
    const row = document.createElement('label');
    row.className = 'setting setting-select';
    const name = document.createElement('span');
    name.textContent = t('settings.language');
    const select = document.createElement('select');
    select.id = 'hud-language';
    select.add(new Option(t('settings.languageAuto'), 'auto'));
    select.add(new Option('English', 'en'));
    select.add(new Option('Deutsch', 'de'));
    select.value = getLanguagePreference();
    select.addEventListener('change', () => setLanguage(select.value));
    row.append(name, select);
    return row;
  }

  let shownIndex = null;
  function renderAll() {
    const selected = visualizerSelect.value;
    visualizerSelect.replaceChildren(...visualizers.map(({ name }, index) => new Option(name, String(index))));
    if (selected) visualizerSelect.value = selected;
    sharedSections.replaceChildren();
    for (const { id, title, schema, onChange } of sections) {
      const heading = document.createElement('h3');
      heading.textContent = t(title);
      sharedSections.append(heading);
      renderFields(sharedSections, id, schema, onChange);
    }
    const heading = document.createElement('h3');
    heading.textContent = t('settings.languageHeading');
    sharedSections.append(heading, renderLanguage());
    if (shownIndex !== null) showVisualizer(shownIndex);
    applyState();
  }

  function showVisualizer(index) {
    const { id, settingsSchema = [] } = visualizers[index];
    shownIndex = index;
    visualizerSelect.value = String(index);
    activeSection.replaceChildren();
    renderFields(activeSection, id, settingsSchema);
  }

  renderAll();
  onLanguageChange(renderAll);

  return {
    settingsFor,
    get pinned() {
      return state.pinned;
    },
    showVisualizer,
  };
}

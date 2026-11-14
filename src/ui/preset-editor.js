// Preset editor (M key): change the running Milkdrop preset live, with music.
// Tabs: base values, equations (init, frame, pixel), shapes, waves and the two shaders (warp, comp).
// After a short pause in typing, the change is checked and applied. On an error the last working
// version keeps running, and the editor shows part, line and reason. "Save" writes a .milk file into the presets
// folder: bundled presets as a variation into edited/, own ones back into their file. See docs/preset-editor.md.
// With `reference` this creates the second window for reference (N key): any preset, only for reading and copying.
import { onLanguageChange, t } from '../i18n/i18n.js';
import { downloadText } from './download.js';
import { highlight } from '../milk/highlight.js';
import { TEMPLATES } from '../milk/templates.js';
import { helpFor, valueInfo } from '../milk/variables.js';
import { checkPreset } from '../milk/preset-check.js';
import {
  CODE_PARTS,
  SHADER_PARTS,
  SHAPE_CODE,
  SHAPE_COUNT,
  WAVE_CODE,
  WAVE_COUNT,
  clonePreset,
  differs,
  editableValues,
  parseNumber,
} from '../milk/preset-model.js';

const APPLY_DELAY_MS = 400;
const MORE = 'more'; // group for values that variables.js does not describe
const TAB_TEXT = '  ';

// Texts that follow a language switch: `render` sets them now and again after every switch.
const bindings = new Set();
onLanguageChange(() => {
  for (const render of bindings) render();
});
function bound(render) {
  render();
  bindings.add(render);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

// Step size of the arrow keys in value fields: normally 0.01, with Shift 0.1, with Alt 1.
function arrowStep(event) {
  if (event.altKey) return 1;
  return event.shiftKey ? 0.1 : 0.01;
}

// List of numeric values, grouped by section and with explanations. Differences from the default are highlighted.
// `kind` is 'base', 'shape' or 'wave' (valueInfo in variables.js). `hidden` are keys handled elsewhere (such as enabled).
// `hint` and `placeholder` are translation keys.
function createValueList({ hint, placeholder, kind, hidden = [], openGroups = null, readOnly = false }) {
  const root = element('div', 'pe-values');
  const tools = element('div', 'pe-values-tools');
  const filter = element('input', 'pe-filter');
  filter.type = 'search';
  bound(() => {
    filter.placeholder = t(placeholder);
    filter.setAttribute('aria-label', t('editor.filterValues'));
  });
  const onlyChangedLabel = element('label', 'pe-only-changed');
  const onlyChanged = element('input');
  onlyChanged.type = 'checkbox';
  const onlyChangedText = document.createTextNode('');
  bound(() => (onlyChangedText.textContent = ` ${t('editor.onlyChanged')}`));
  onlyChangedLabel.append(onlyChanged, onlyChangedText);
  tools.append(filter, onlyChangedLabel);
  const list = element('div', 'pe-groups');
  if (hint) {
    const hintNode = element('p', 'pe-hint');
    bound(() => (hintNode.textContent = t(hint)));
    root.append(hintNode);
  }
  root.append(tools, list);
  const openState = new Map(); // section → expanded, kept when switching the preset

  const applyFilter = () => {
    const query = filter.value.trim().toLowerCase();
    for (const group of list.children) {
      let visible = 0;
      for (const row of group.querySelectorAll('.pe-base-row')) {
        row.hidden = (query !== '' && !row.dataset.search.includes(query)) || (onlyChanged.checked && !row.classList.contains('changed'));
        if (!row.hidden) visible += 1;
      }
      group.hidden = visible === 0;
      // While searching, expand everything that matches.
      if (query || onlyChanged.checked) group.open = true;
      else group.open = openState.get(group.dataset.group) ?? (openGroups ? openGroups.includes(group.dataset.group) : true);
    }
  };
  filter.addEventListener('input', applyFilter);
  onlyChanged.addEventListener('change', applyFilter);

  // The last values shown, so a language switch can render them again.
  let shownWith = null;
  bindings.add(() => shownWith && render(...shownWith));

  // `values` is changed directly while typing; afterwards `onChange` reports the change.
  function render(values, defaults, onChange) {
    shownWith = [values, defaults, onChange];
    const info = valueInfo(kind);
    list.replaceChildren();
    const groups = new Map([...info.order, MORE].map((name) => [name, []]));
    for (const entry of editableValues(values, defaults)) {
      if (hidden.includes(entry.key)) continue;
      const known = info.map.get(entry.key);
      groups.get(known?.group ?? MORE).push({ ...entry, text: known?.text ?? '' });
    }
    for (const [name, entries] of groups) {
      if (entries.length === 0) continue;
      const group = element('details', 'pe-group');
      group.dataset.group = name;
      const summary = element('summary', '', name === MORE ? t('editor.moreGroup') : info.labels.get(name));
      group.addEventListener('toggle', () => {
        if (!filter.value.trim() && !onlyChanged.checked) openState.set(name, group.open);
      });
      const grid = element('div', 'pe-base-list');
      // Order as in variables.js: important ones first. Unknown ones alphabetically.
      const order = [...info.map.keys()];
      entries.sort((a, b) => (order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999) || a.key.localeCompare(b.key));
      for (const { key, value, changed, text } of entries) {
        const row = element('label', 'pe-base-row');
        row.dataset.key = key.toLowerCase();
        row.dataset.search = `${key} ${text}`.toLowerCase();
        row.classList.toggle('changed', changed);
        const label = element('span', 'pe-base-label');
        label.append(element('span', 'pe-base-key', key));
        if (text) label.append(element('span', 'pe-base-text', text));
        row.title = [text, key in defaults ? t('editor.defaultValue', { value: formatNumber(defaults[key]) }) : ''].filter(Boolean).join('\n');
        const input = element('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = formatNumber(value);
        input.spellcheck = false;
        input.readOnly = readOnly;
        const commit = (number) => {
          values[key] = number;
          row.classList.toggle('changed', key in defaults ? number !== defaults[key] : true);
          onChange(key, number);
        };
        input.addEventListener('input', () => {
          const number = parseNumber(input.value);
          input.classList.toggle('invalid', number === null);
          if (number !== null) commit(number);
        });
        input.addEventListener('keydown', (event) => {
          if (readOnly || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
          event.preventDefault();
          const current = parseNumber(input.value) ?? 0;
          const next = Number((current + (event.key === 'ArrowUp' ? 1 : -1) * arrowStep(event)).toFixed(6));
          input.value = formatNumber(next);
          input.classList.remove('invalid');
          commit(next);
        });
        row.append(label, input);
        grid.append(row);
      }
      group.append(summary, grid);
      list.append(group);
    }
    applyFilter();
  }

  return { element: root, render };
}

// Text field for equations or shaders, with line numbers and syntax colouring. The error line turns red.
// The colours lie on a layer below the text field, whose own text is transparent.
// `label` and `hint` are functions returning the text in the current language.
function createCodeField({ label, hint, compact = false, language = 'eel', readOnly = false }) {
  const root = element('div', `pe-field${compact ? ' compact' : ''}`);
  const code = element('div', 'pe-code');
  const gutter = element('pre', 'pe-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  const area = element('div', 'pe-code-area');
  const colors = element('pre', 'pe-highlight');
  colors.setAttribute('aria-hidden', 'true');
  const textarea = element('textarea', 'pe-textarea');
  textarea.spellcheck = false;
  textarea.wrap = 'off';
  textarea.readOnly = readOnly;
  bound(() => textarea.setAttribute('aria-label', label()));
  area.append(colors, textarea);
  code.append(gutter, area);
  if (compact) {
    const labelNode = element('div', 'pe-field-label');
    bound(() => (labelNode.textContent = label()));
    root.append(labelNode);
  }
  if (hint) {
    const hintNode = element('p', 'pe-hint');
    bound(() => (hintNode.textContent = hint()));
    root.append(hintNode);
  }
  root.append(code);

  let errorLine = null;
  function syncScroll() {
    gutter.scrollTop = textarea.scrollTop;
    colors.scrollTop = textarea.scrollTop;
    colors.scrollLeft = textarea.scrollLeft;
  }
  function renderGutter() {
    const lines = textarea.value.split('\n').length;
    gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => element('span', i + 1 === errorLine ? 'error' : '', `${i + 1}\n`)));
    colors.innerHTML = highlight(textarea.value, language);
    // Small fields (shapes, waves) grow with their content: two lines when empty, at most fourteen.
    if (compact) code.style.height = `${Math.min(Math.max(lines, 2), 14) * 18 + 16}px`;
    syncScroll();
  }

  textarea.addEventListener('scroll', syncScroll);
  // Tab indents instead of leaving the field. Escape gets you out again.
  textarea.addEventListener('keydown', (event) => {
    if (readOnly || event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    textarea.setRangeText(TAB_TEXT, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input'));
  });

  return {
    element: root,
    textarea,
    get value() {
      return textarea.value;
    },
    setValue(text) {
      textarea.value = text ?? '';
      renderGutter();
    },
    setErrorLine(line) {
      errorLine = line ?? null;
      renderGutter();
    },
    onInput(listener) {
      textarea.addEventListener('input', () => {
        renderGutter();
        listener(textarea.value);
      });
    },
  };
}

// Expandable help: variables and functions of the section. A click inserts the name into the last used field.
function createHelp(context, getTarget) {
  const root = element('details', 'pe-help');
  const summary = element('summary');
  const filter = element('input', 'pe-filter');
  filter.type = 'search';
  const list = element('div', 'pe-help-list');

  const applyFilter = () => {
    const query = filter.value.trim().toLowerCase();
    for (const row of list.children) row.hidden = query !== '' && !row.dataset.search.includes(query);
  };

  // Rebuilt on a language switch, because the explanations change.
  function fill() {
    summary.textContent = t('editor.help');
    filter.placeholder = t('editor.helpSearch');
    filter.setAttribute('aria-label', t('editor.helpSearchLabel'));
    list.replaceChildren();
    for (const { name, text, kind } of helpFor(context)) {
      const row = element('button', 'pe-help-row');
      row.type = 'button';
      row.dataset.search = `${name} ${text}`.toLowerCase();
      row.title = t('editor.helpInsert');
      row.append(element('code', 'pe-help-name', name), element('span', 'pe-help-kind', kind), element('span', 'pe-help-text', text));
      row.addEventListener('click', () => {
        const textarea = getTarget();
        if (!textarea || textarea.readOnly) return;
        // "q1 … q32" inserts q1, "sin(x)" inserts "sin(".
        const insert = name.includes(' … ') ? name.split(' ')[0] : name.includes('(') ? name.slice(0, name.indexOf('(') + 1) : name;
        textarea.focus();
        textarea.setRangeText(insert, textarea.selectionStart, textarea.selectionEnd, 'end');
        textarea.dispatchEvent(new Event('input'));
      });
      list.append(row);
    }
    applyFilter();
  }

  bound(fill);
  filter.addEventListener('input', applyFilter);
  root.append(summary, filter, list);
  return { element: root };
}

// Remembers the last used text field in a section, for the help.
function lastTextareaIn(pane) {
  let last = null;
  pane.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLTextAreaElement) last = event.target;
  });
  return () => last ?? pane.querySelector('textarea');
}

// `getMilkdrop` returns the active visualizer if it can edit presets, otherwise null.
export function createPresetEditor({ root, getMilkdrop, customPresets, onChange, reference = false }) {
  const readOnly = reference;
  const nameLabel = root.querySelector('.pe-name');
  const stateLabel = root.querySelector('.pe-state');
  const tabs = root.querySelector('.pe-tabs');
  const body = root.querySelector('.pe-body');
  const status = root.querySelector('.pe-status');
  const resetButton = root.querySelector('.pe-reset');
  const saveButton = root.querySelector('.pe-save');
  const newButton = root.querySelector('.pe-new');
  const newMenu = root.querySelector('.pe-new-menu');
  const newName = newMenu.querySelector('input');
  const templateList = newMenu.querySelector('.pe-templates');

  // Reference window: instead of New, Save and Reset, a search for the preset and "Running".
  const picker = element('input', 'pe-pick');
  const pickerList = element('datalist');
  const followButton = element('button', 'pe-follow pb-tool');
  if (reference) {
    const title = root.querySelector('.pe-title');
    const closeButton = root.querySelector('.pe-close');
    // The copied HTML still carries the editor's keys; the reference window has its own texts.
    delete title.dataset.i18n;
    delete closeButton.dataset.i18nAriaLabel;
    bound(() => {
      title.textContent = t('editor.referenceTitle');
      closeButton.setAttribute('aria-label', t('editor.referenceClose'));
      picker.setAttribute('aria-label', t('editor.referenceSearch'));
      followButton.textContent = t('editor.follow');
      followButton.title = t('editor.followTitle');
    });
    stateLabel.hidden = true;
    for (const button of [newButton, saveButton, resetButton, newMenu]) button.remove();
    pickerList.id = `${root.id}-names`;
    picker.type = 'search';
    picker.setAttribute('list', pickerList.id);
    picker.spellcheck = false;
    followButton.type = 'button';
    const row = element('div', 'pe-pick-row');
    row.append(picker, pickerList, followButton);
    nameLabel.replaceWith(row);
    picker.addEventListener('change', () => {
      const name = picker.value.trim();
      if (getMilkdrop()?.presetData(name)) showPreset(name);
    });
    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') picker.dispatchEvent(new Event('change'));
    });
    followButton.addEventListener('click', () => showPreset(getMilkdrop()?.presetName));
  }

  function fillPicker() {
    const names = getMilkdrop()?.presetNames ?? [];
    if (pickerList.childElementCount === names.length) return;
    pickerList.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
  }

  function showPreset(name) {
    if (!reference || !name) return;
    referenceName = name;
    if (open) load();
  }

  let open = false;
  let referenceName = null; // only in the reference window: the preset shown
  let shown = null; // { name, original, defaults: { base, shape, wave } }
  let draft = null; // the version in the editor, even if it currently has errors
  let errors = [];
  let applyTimer = null;
  let activeTab = 'frame';
  let unsubscribe = null;
  const panes = new Map();
  const tabButtons = new Map();
  const partTab = new Map(); // part (frame, warp …) → tab (code, shader)
  const subButtons = new Map(); // part → button within the tab
  const subPanes = new Map(); // part → pane within the tab
  const activeSub = new Map(); // tab → selected part
  const refreshers = []; // per tab: rebuild the content from `draft`
  const errorViews = []; // per tab: show errors

  const tabOf = (part) => (part.startsWith('shape') ? 'shapes' : part.startsWith('wave') ? 'waves' : (partTab.get(part) ?? part));

  // `label`: translation key.
  function addTab(id, label, pane) {
    const button = element('button', 'pe-tab');
    bound(() => (button.textContent = t(label)));
    button.type = 'button';
    button.dataset.tab = id;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => selectTab(id));
    tabs.append(button);
    tabButtons.set(id, button);
    pane.classList.add('pe-pane');
    pane.dataset.tab = id;
    body.append(pane);
    panes.set(id, pane);
  }

  // Tabs with several parts (equations: frame, pixel, init; shaders: warp, comp), switched with small buttons.
  function addGroupTab(id, label, parts) {
    const pane = element('div', 'pe-group-pane');
    const switcher = element('div', 'pe-subtabs');
    switcher.setAttribute('role', 'group');
    bound(() => switcher.setAttribute('aria-label', t(label)));
    pane.append(switcher);
    for (const part of parts) {
      const button = element('button', 'pe-item pe-subtab');
      bound(() => (button.textContent = part.label));
      button.type = 'button';
      button.dataset.part = part.id;
      button.addEventListener('click', () => selectTab(part.id));
      switcher.append(button);
      part.pane.classList.add('pe-subpane');
      part.pane.dataset.part = part.id;
      pane.append(part.pane);
      partTab.set(part.id, id);
      subButtons.set(part.id, button);
      subPanes.set(part.id, part.pane);
    }
    activeSub.set(id, parts[0].id);
    addTab(id, label, pane);
  }

  // Selects a tab or directly a part, such as 'frame' or 'comp'.
  function selectTab(id) {
    const tab = partTab.get(id) ?? id;
    if (partTab.has(id)) activeSub.set(tab, id);
    activeTab = id;
    for (const [tabId, button] of tabButtons) button.setAttribute('aria-selected', String(tabId === tab));
    for (const [paneId, pane] of panes) pane.hidden = paneId !== tab;
    for (const [part, pane] of subPanes) {
      const visible = activeSub.get(partTab.get(part)) === part;
      pane.hidden = !visible;
      subButtons.get(part).setAttribute('aria-pressed', String(visible));
    }
  }

  function changed() {
    if (readOnly) return;
    updateState();
    scheduleApply();
  }

  // --- Base values ---
  const baseValues = createValueList({
    hint: 'editor.baseHint',
    placeholder: 'editor.baseSearch',
    kind: 'base',
    openGroups: ['motion', 'image'],
    readOnly,
  });
  const basePane = element('div', 'pe-base');
  basePane.append(baseValues.element);
  addTab('base', 'editor.tabs.base', basePane);
  refreshers.push(() => baseValues.render((draft.baseVals ??= {}), shown.defaults.base, changed));

  // --- Equations and shaders: one text field each, with help ---
  // `label` and `hint`: functions returning the text.
  function codePart(part, { label, hint = () => part.hint, helpContext, language }) {
    const field = createCodeField({ label, hint, language, readOnly });
    field.onInput((text) => {
      draft[part.key] = text;
      changed();
    });
    const pane = element('div', 'pe-code-pane');
    pane.append(field.element, createHelp(helpContext, () => field.textarea).element);
    refreshers.push(() => field.setValue(draft[part.key]));
    errorViews.push(() => field.setErrorLine(errors.find((error) => error.part === part.id)?.line));
    return { id: part.id, label: part.label, pane };
  }

  // Frame first: that is where most happens. Init is rarely needed.
  const codeOrder = ['frame', 'pixel', 'init'].map((id) => CODE_PARTS.find((part) => part.id === id));
  addGroupTab(
    'code',
    'editor.tabs.code',
    codeOrder.map((part) => codePart(part, { label: () => t('editor.equations', { part: part.label }), helpContext: part.id, language: 'eel' })),
  );

  // --- Shapes and waves: same layout, four of each ---
  function addItemsTab({ id, label, kind, count, codeParts, itemLabel, defaultsKey, hint }) {
    const prefix = kind.slice(0, -1); // 'shape' or 'wave', as in the ids of codeSlots
    const pane = element('div', 'pe-items-pane');
    const picker = element('div', 'pe-items');
    picker.setAttribute('role', 'group');
    bound(() => picker.setAttribute('aria-label', t(label)));
    const enabledLabel = element('label', 'pe-enabled');
    const enabled = element('input');
    enabled.type = 'checkbox';
    enabled.disabled = readOnly;
    const enabledText = document.createTextNode('');
    bound(() => (enabledText.textContent = ` ${t('editor.enabled')}`));
    enabledLabel.append(enabled, enabledText);
    const head = element('div', 'pe-items-head');
    head.append(picker, enabledLabel);
    const scroll = element('div', 'pe-items-scroll');
    const values = createValueList({ placeholder: 'editor.itemSearch', kind: defaultsKey, hidden: ['enabled'], readOnly });
    const fields = codeParts.map((part) => ({ part, field: createCodeField({ label: () => part.label, hint: () => part.hint, compact: true, readOnly }) }));
    scroll.append(...fields.map(({ field }) => field.element), values.element);
    const hintNode = element('p', 'pe-hint');
    bound(() => (hintNode.textContent = t(hint)));
    pane.append(hintNode, head, scroll, createHelp(kind.slice(0, -1), lastTextareaIn(pane)).element);
    addTab(id, label, pane);

    let selected = 0;
    const buttons = Array.from({ length: count }, (_, i) => {
      const button = element('button', 'pe-item');
      bound(() => (button.textContent = t(itemLabel, { number: i + 1 })));
      button.type = 'button';
      button.addEventListener('click', () => {
        selected = i;
        refresh();
        showItemErrors();
      });
      picker.append(button);
      return button;
    });

    const item = (i = selected) => {
      draft[kind] ??= [];
      draft[kind][i] ??= { baseVals: {} };
      draft[kind][i].baseVals ??= {};
      return draft[kind][i];
    };
    const isOn = (i) => Boolean(draft[kind]?.[i]?.baseVals?.enabled);

    function markButtons() {
      buttons.forEach((button, i) => {
        button.setAttribute('aria-pressed', String(i === selected));
        button.classList.toggle('on', isOn(i));
        button.classList.toggle('has-error', errors.some((error) => error.part.startsWith(`${prefix}${i}-`)));
      });
    }

    function refresh() {
      const current = item();
      enabled.checked = isOn(selected);
      values.render(current.baseVals, shown.defaults[defaultsKey], (key) => {
        if (key === 'enabled') enabled.checked = isOn(selected);
        markButtons();
        changed();
      });
      for (const { part, field } of fields) field.setValue(current[part.key]);
      markButtons();
    }

    function showItemErrors() {
      for (const { part, field } of fields) field.setErrorLine(errors.find((error) => error.part === `${prefix}${selected}-${part.id}`)?.line);
      markButtons();
    }

    enabled.addEventListener('change', () => {
      item().baseVals.enabled = enabled.checked ? 1 : 0;
      refresh();
      changed();
    });
    for (const { part, field } of fields) {
      field.onInput((text) => {
        item()[part.key] = text;
        changed();
      });
    }
    refreshers.push(() => {
      // When opening, show the first enabled one, otherwise the first.
      const firstOn = Array.from({ length: count }, (_, i) => i).find(isOn);
      selected = firstOn ?? 0;
      refresh();
    });
    errorViews.push(showItemErrors);
  }

  addItemsTab({
    id: 'shapes',
    label: 'editor.tabs.shapes',
    kind: 'shapes',
    count: SHAPE_COUNT,
    codeParts: SHAPE_CODE,
    itemLabel: 'editor.shape',
    defaultsKey: 'shape',
    hint: 'editor.shapesHint',
  });
  addItemsTab({
    id: 'waves',
    label: 'editor.tabs.waves',
    kind: 'waves',
    count: WAVE_COUNT,
    codeParts: WAVE_CODE,
    itemLabel: 'editor.wave',
    defaultsKey: 'wave',
    hint: 'editor.wavesHint',
  });

  // --- Shader ---
  addGroupTab(
    'shader',
    'editor.tabs.shader',
    SHADER_PARTS.map((part) =>
      codePart(part, {
        label: () => t('editor.shaderLabel', { part: part.label }),
        hint: () => `${part.hint} ${t('editor.shaderHint')}`,
        helpContext: 'shader',
        language: 'glsl',
      }),
    ),
  );

  // --- State and applying ---
  // `text`: a function, so the status follows a language switch.
  let statusText = null;
  function setStatus(kind, text) {
    status.dataset.kind = kind;
    statusText = text;
    status.textContent = text();
  }
  bindings.add(() => {
    if (statusText) status.textContent = statusText();
    if (shown) updateState();
  });

  function showErrors(list) {
    errors = list;
    for (const [id, button] of tabButtons) button.classList.toggle('has-error', errors.some((error) => tabOf(error.part) === id));
    for (const [part, button] of subButtons) button.classList.toggle('has-error', errors.some((error) => error.part === part));
    for (const view of errorViews) view();
  }

  // Yellow dot on tabs and parts that differ from the original.
  function markModified() {
    const original = shown.original;
    const textDiffers = (key) => (original[key] ?? '') !== (draft[key] ?? '');
    const partDiffers = new Map([...CODE_PARTS, ...SHADER_PARTS].map((part) => [part.id, textDiffers(part.key)]));
    const tabDiffers = {
      base: differs({ baseVals: original.baseVals }, { baseVals: draft.baseVals }),
      code: CODE_PARTS.some((part) => partDiffers.get(part.id)),
      shapes: differs({ shapes: original.shapes }, { shapes: draft.shapes }),
      waves: differs({ waves: original.waves }, { waves: draft.waves }),
      shader: SHADER_PARTS.some((part) => partDiffers.get(part.id)),
    };
    for (const [id, button] of tabButtons) button.classList.toggle('modified', Boolean(tabDiffers[id]));
    for (const [part, button] of subButtons) button.classList.toggle('modified', partDiffers.get(part));
  }

  function describe(error) {
    const message = /[.?!]$/.test(error.message) ? error.message : `${error.message}.`;
    return error.line ? t('editor.errorAtLine', { part: error.label, line: error.line, message }) : `${error.label}: ${message}`;
  }

  function updateState() {
    if (readOnly) {
      markModified();
      return;
    }
    const edited = differs(shown.original, draft);
    const own = customPresets?.has(shown.name) ?? false;
    const fresh = customPresets?.isNew(shown.name) ?? false;
    const state = fresh ? 'new' : edited ? 'edited' : own ? 'saved' : 'original';
    stateLabel.textContent = t(`editor.state.${state}`);
    stateLabel.dataset.state = state; // for tests, independent of the language
    stateLabel.classList.toggle('fresh', fresh && !edited);
    stateLabel.classList.toggle('edited', edited);
    markModified();
    resetButton.disabled = !edited;
    resetButton.title = t(own ? 'editor.resetSaved' : 'editor.resetTitle');
    if (!customPresets) {
      saveButton.disabled = true;
      return;
    }
    // In browser mode you may also save unchanged presets: that downloads the file again.
    const browser = customPresets.state === 'browser';
    saveButton.disabled = own && !edited && !browser;
    const target = customPresets.targetFor(shown.name);
    saveButton.title = t(browser ? 'editor.saveBrowserTitle' : 'editor.saveTitle', target);
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    setStatus('pending', () => t('editor.status.pending'));
    applyTimer = setTimeout(apply, APPLY_DELAY_MS);
  }

  async function apply() {
    applyTimer = null;
    const milkdrop = getMilkdrop();
    if (!milkdrop || !shown) return;
    const formulaErrors = checkPreset(draft);
    if (formulaErrors.length) {
      showErrors(formulaErrors);
      setStatus('error', () => `${describe(formulaErrors[0])} ${t('editor.status.lastWorking')}`);
      return;
    }
    try {
      await milkdrop.previewPreset(clonePreset(draft));
      showErrors([]);
      setStatus('ok', () => t('editor.status.running'));
    } catch (error) {
      if (error.shaderErrors) {
        showErrors(error.shaderErrors);
        setStatus('error', () => `${describe(error.shaderErrors[0])} ${t('editor.status.lastWorking')}`);
      } else {
        setStatus('error', () => t('editor.status.loadFailed', { error: error.message }));
      }
    }
    updateState();
  }

  async function save() {
    const milkdrop = getMilkdrop();
    if (!milkdrop || !shown || !customPresets) return;
    try {
      // First the folder, while the click is still fresh. Chrome only allows the dialog right after a click.
      if (customPresets.state !== 'connected') await customPresets.connect();
      if (applyTimer) {
        clearTimeout(applyTimer);
        await apply();
      }
      if (errors.length || checkPreset(draft).length) {
        if (!errors.length) showErrors(checkPreset(draft));
        setStatus('error', () => t('editor.status.fixFirst'));
        return;
      }
      const from = shown.name;
      const target = await customPresets.save(from, clonePreset(draft));
      // A bundled preset stays unchanged. Work continues with the saved variation.
      if (target.name !== from) {
        await milkdrop.selectPreset(target.name, { blendSeconds: 0 });
        milkdrop.dropEdit(from);
      }
      load();
      if (customPresets.state === 'browser') {
        downloadText(target.fileName, target.text);
        setStatus('ok', () => t('editor.status.savedBrowser', target));
        return;
      }
      const path = [customPresets.folderName, target.folder, target.fileName].filter(Boolean).join('/');
      setStatus('ok', () => t(target.overwritten ? 'editor.status.overwritten' : 'editor.status.saved', { path }));
    } catch (error) {
      if (error.name === 'AbortError') setStatus('ok', () => t('editor.status.saveAborted'));
      else setStatus('error', () => t('editor.status.saveFailed', { error: error.message }));
    }
  }

  function load() {
    const milkdrop = getMilkdrop();
    if (!milkdrop) return;
    clearTimeout(applyTimer);
    applyTimer = null;
    let current = reference && referenceName ? milkdrop.presetData(referenceName) : null;
    current ??= milkdrop.currentPreset();
    referenceName = current.name;
    shown = { name: current.name, original: current.original, defaults: current.defaults };
    draft = current.edited;
    nameLabel.textContent = current.name;
    nameLabel.title = current.name;
    for (const refresh of refreshers) refresh();
    showErrors([]);
    if (reference) {
      picker.value = '';
      picker.placeholder = current.name;
      setStatus('ok', () => t(current.isEdited ? 'editor.status.readOnlyEdited' : 'editor.status.readOnly'));
      updateState();
      return;
    }
    const warnings = customPresets?.get(current.name)?.warnings ?? [];
    if (warnings.length) setStatus('ok', () => t('editor.status.runningNote', { note: warnings.join(' ') }));
    else setStatus('ok', () => t(current.isEdited ? 'editor.status.runningEdited' : 'editor.status.running'));
    updateState();
  }

  // --- New from template ---
  function uniqueName(name) {
    const taken = new Set(getMilkdrop()?.presetNames ?? []);
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
  }

  function toggleNewMenu(show = newMenu.hidden) {
    newMenu.hidden = !show;
    newButton.setAttribute('aria-expanded', String(show));
    if (show) newName.focus();
  }

  async function createFromTemplate(template) {
    const milkdrop = getMilkdrop();
    if (!milkdrop) return;
    const typed = newName.value.trim().replace(/[\\/:*?"<>|]/g, '_');
    const name = uniqueName(typed || t('editor.defaultName', { template: template.name }));
    milkdrop.addPresets({ [name]: template.preset() });
    customPresets?.registerNew(name);
    await milkdrop.selectPreset(name, { blendSeconds: 0 });
    newName.value = '';
    toggleNewMenu(false);
    load();
    setStatus('ok', () => t('editor.status.fromTemplate', { template: template.name }));
  }

  for (const template of TEMPLATES) {
    const button = element('button', 'pe-template');
    button.type = 'button';
    button.dataset.template = template.id;
    const name = element('span', 'pe-template-name');
    const text = element('span', 'pe-template-text');
    bound(() => {
      name.textContent = template.name;
      text.textContent = template.description;
    });
    button.append(name, text);
    button.addEventListener('click', () => createFromTemplate(template));
    templateList.append(button);
  }
  newMenu.addEventListener('submit', (event) => {
    event.preventDefault();
    createFromTemplate(TEMPLATES[0]);
  });
  newButton.addEventListener('click', () => toggleNewMenu());

  saveButton.addEventListener('click', save);
  resetButton.addEventListener('click', async () => {
    await getMilkdrop()?.resetPreset();
    load();
  });
  root.querySelector('.pe-close').addEventListener('click', () => close());

  function show() {
    const milkdrop = getMilkdrop();
    if (!milkdrop) return;
    open = true;
    root.hidden = false;
    if (reference) {
      fillPicker();
      load();
      selectTab(activeTab);
      onChange?.();
      return;
    }
    milkdrop.holdAutoAdvance(true);
    unsubscribe = milkdrop.onEditError((error) => {
      setStatus('error', () => t('editor.status.runtimeError', { error: error.message }));
    });
    load();
    selectTab(activeTab);
    onChange?.();
  }

  function close() {
    if (!open) return;
    open = false;
    // Apply pending changes, so nothing gets lost.
    if (applyTimer) {
      clearTimeout(applyTimer);
      apply();
    }
    if (root.contains(document.activeElement)) document.activeElement.blur();
    toggleNewMenu(false);
    root.hidden = true;
    if (!reference) getMilkdrop()?.holdAutoAdvance(false);
    unsubscribe?.();
    unsubscribe = null;
    onChange?.();
  }

  return {
    get open() {
      return open;
    },
    get status() {
      return { kind: status.dataset.kind, text: status.textContent };
    },
    get errors() {
      return errors;
    },
    selectTab,
    // Only in the reference window: shows the preset with this name.
    showPreset,
    get shownName() {
      return shown?.name ?? null;
    },
    toggle: () => (open ? close() : show()),
    close,
    // Call after every change of visualizer or preset.
    update() {
      if (!open) return;
      const milkdrop = getMilkdrop();
      if (!milkdrop) close();
      else if (reference) {
        // Does not follow the running preset. Only if the shown one has disappeared (deleted), back to the running one.
        fillPicker();
        if (!milkdrop.presetData(referenceName)) {
          referenceName = null;
          load();
        }
      } else if (milkdrop.presetName !== shown?.name) load();
    },
  };
}

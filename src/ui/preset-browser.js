// Preset browser: small arrows, a star and a button that opens a list.
// The list always appears as a bar on the right edge, no matter how large the collection is.
// The selected collection is also the one that is played from.
import { onLanguageChange, t } from '../i18n/i18n.js';
import { browserHint } from '../milk/custom-store.js';
import { downloadText } from './download.js';
import { ALL, BACKUP_FILE, FAVORITES, OWN, parsePresetName } from './preset-library.js';

const PREVIEW_FILE = 'previews.json';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Placeholder while there is no preview image: a gradient that stays the same for each preset.
function placeholderFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 35%), hsl(${(hue + 60) % 360} 70% 15%))`;
}

export function createPresetBrowser({ hud, library, customPresets, getVisualizer, onChange }) {
  const row = hud.querySelector('#hud-preset');
  const favoriteButton = row.querySelector('#hud-favorite');
  const browseButton = row.querySelector('#hud-browse');
  const panel = document.getElementById('preset-browser');
  const collectionSelect = panel.querySelector('#pb-collection');
  const search = panel.querySelector('#pb-search');
  const list = panel.querySelector('#pb-list');
  const note = panel.querySelector('#pb-note');
  const nameForm = panel.querySelector('#pb-name-form');
  const nameInput = nameForm.querySelector('input');
  const renameButton = panel.querySelector('#pb-rename');
  const deleteButton = panel.querySelector('#pb-delete');
  const folderRow = panel.querySelector('#pb-folder');
  const folderText = folderRow.querySelector('.pb-folder-text');
  const folderAction = folderRow.querySelector('.pb-folder-action');
  const folderOpen = folderRow.querySelector('.pb-folder-open');
  const folderFiles = folderRow.querySelector('.pb-folder-files');
  const backupButton = folderRow.querySelector('.pb-backup');

  let previews = null;
  let previewsShown = false;
  let previewsRequested = false;
  let open = false;
  let formMode = null; // 'create' or 'rename'
  let openMenu = null;
  let shownKey = ''; // content of the list, so it is only rebuilt when that changes

  function loadPreviews() {
    if (previewsRequested) return;
    previewsRequested = true;
    fetch(PREVIEW_FILE)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}))
      .then((data) => {
        previews = data;
        if (open) renderList({ jumpToPlaying: false });
      });
  }

  const presetVisualizer = () => {
    const visualizer = getVisualizer();
    return visualizer?.presetNames ? visualizer : null;
  };

  function updateRow() {
    const visualizer = presetVisualizer();
    row.hidden = !visualizer;
    if (!visualizer) {
      close();
      return;
    }
    const favorite = library.isFavorite(visualizer.presetName);
    favoriteButton.setAttribute('aria-pressed', String(favorite));
    favoriteButton.title = t(favorite ? 'browser.unfavorite' : 'browser.favorite');
  }

  function fillCollections() {
    const visualizer = presetVisualizer();
    const all = visualizer?.presetNames ?? [];
    collectionSelect.replaceChildren(
      ...library.collections.map(({ id, name }) => new Option(`${name} (${library.namesOf(id, all).length})`, id)),
    );
    collectionSelect.value = library.active;
    const custom = !library.collections.find((entry) => entry.id === library.active)?.builtIn;
    renameButton.hidden = !custom;
    deleteButton.hidden = !custom;
  }

  function closeMenu() {
    openMenu?.remove();
    openMenu = null;
  }

  // Small menu on an entry: which own collections the preset belongs to.
  function showCollectionMenu(anchor, name) {
    closeMenu();
    const menu = element('div', 'pb-menu');
    const custom = library.customCollections;
    if (custom.length === 0) menu.append(element('p', 'pb-menu-empty', t('browser.noCollection')));
    for (const { id, name: collectionName } of custom) {
      const label = element('label', 'pb-menu-item');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = library.contains(id, name);
      checkbox.addEventListener('change', () => library.toggle(id, name));
      label.append(checkbox, document.createTextNode(collectionName));
      menu.append(label);
    }
    const create = element('button', 'pb-menu-create', t('browser.newWithPreset'));
    create.type = 'button';
    create.addEventListener('click', () => {
      closeMenu();
      showNameForm('create', name);
    });
    menu.append(create);
    anchor.after(menu);
    openMenu = menu;
  }

  function entryFor(name, playing) {
    const { title, author } = parsePresetName(name);
    const item = element('li', 'pb-entry');
    item.dataset.name = name;
    if (name === playing) item.classList.add('playing');

    const select = element('button', 'pb-select');
    select.type = 'button';
    select.title = name;
    const thumb = element('span', 'pb-thumb');
    const image = previews?.[name];
    thumb.style.backgroundImage = image ? `url(${image})` : placeholderFor(name);
    const text = element('span', 'pb-text');
    text.append(element('span', 'pb-title', title));
    if (author) text.append(element('span', 'pb-author', author));
    if (customPresets?.has(name)) {
      item.classList.add('own');
      text.append(element('span', 'pb-badge', t('browser.ownBadge', { folder: customPresets.get(name).folder })));
    }
    select.append(thumb, text);
    select.addEventListener('click', () => {
      presetVisualizer()?.selectPreset(name);
      onChange();
    });

    const star = element('button', 'pb-star');
    star.type = 'button';
    const favorite = library.isFavorite(name);
    star.setAttribute('aria-pressed', String(favorite));
    star.setAttribute('aria-label', t(favorite ? 'browser.unfavorite' : 'browser.favorite'));
    star.textContent = favorite ? '★' : '☆';
    star.addEventListener('click', () => library.toggleFavorite(name));

    const add = element('button', 'pb-add', '+');
    add.type = 'button';
    add.setAttribute('aria-label', t('browser.addToCollection'));
    add.title = t('browser.addToCollection');
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu.previousElementSibling === add) closeMenu();
      else showCollectionMenu(add, name);
    });

    item.append(select, star, add);
    return item;
  }

  // Update the stars in the list without rebuilding it. This keeps the scroll position.
  // Only changes what has really changed. Every change forces the browser to re-check the list.
  function refreshStars() {
    for (const item of list.children) {
      const star = item.querySelector('.pb-star');
      const favorite = library.isFavorite(item.dataset.name);
      if (star.getAttribute('aria-pressed') === String(favorite)) continue;
      star.setAttribute('aria-pressed', String(favorite));
      star.setAttribute('aria-label', t(favorite ? 'browser.unfavorite' : 'browser.favorite'));
      star.textContent = favorite ? '★' : '☆';
    }
  }

  function markPlaying() {
    const playing = presetVisualizer()?.presetName;
    list.querySelector('.playing')?.classList.remove('playing');
    const item = [...list.children].find((entry) => entry.dataset.name === playing);
    item?.classList.add('playing');
    item?.scrollIntoView({ block: 'nearest' });
  }

  function renderList({ jumpToPlaying = true } = {}) {
    const visualizer = presetVisualizer();
    if (!visualizer) return;
    const names = library.namesOf(library.active, visualizer.presetNames);
    const query = search.value.trim().toLowerCase();
    const shown = query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
    const key = [library.active, query, ...shown].join('|');
    if (key === shownKey && previewsShown === Boolean(previews)) {
      refreshStars();
      if (jumpToPlaying) markPlaying();
      return;
    }
    closeMenu();
    const scrollTop = list.scrollTop;
    shownKey = key;
    previewsShown = Boolean(previews);
    list.replaceChildren(...shown.map((name) => entryFor(name, visualizer.presetName)));
    if (!jumpToPlaying) list.scrollTop = scrollTop;

    if (library.active === FAVORITES && names.length === 0) {
      note.textContent = t('browser.noFavorites');
    } else if (library.active === OWN && names.length === 0) {
      note.textContent = t('browser.noOwn');
    } else if (library.active !== ALL && names.length === 0) {
      note.textContent = t('browser.emptyCollection');
    } else if (query && shown.length === 0) {
      note.textContent = t('browser.nothingFound');
    } else {
      note.textContent = '';
    }
    note.hidden = !note.textContent;
    if (jumpToPlaying) list.querySelector('.playing')?.scrollIntoView({ block: 'nearest' });
  }

  // Row for the presets folder: connect, confirm access, read again, open files.
  function refreshFolder(message = '', problem = false) {
    const state = customPresets?.state ?? 'none';
    folderRow.hidden = !customPresets;
    folderRow.dataset.state = state;
    folderAction.hidden = state === 'browser';
    // .milk files need a place to be stored. Without a connected folder one click would need two file dialogs.
    folderOpen.hidden = state !== 'browser' && state !== 'connected';
    folderText.title = state === 'browser' ? browserHint() : '';
    folderText.classList.toggle('problem', problem);
    if (state === 'browser') {
      folderText.textContent = t('browser.folder.inBrowser', { count: customPresets.names.length });
    } else if (state === 'none') {
      folderText.textContent = t('browser.folder.none');
      folderAction.textContent = t('browser.folder.choose');
    } else if (state === 'prompt') {
      folderText.textContent = t('browser.folder.prompt', { folder: customPresets.folderName });
      folderAction.textContent = t('browser.folder.allow');
    } else if (state === 'connected') {
      folderText.textContent = t('browser.folder.connected', { folder: customPresets.folderName, count: customPresets.names.length });
      folderAction.textContent = t('browser.folder.reload');
    }
    if (message) folderText.textContent += `. ${message}`;
  }

  folderAction.addEventListener('click', async () => {
    try {
      if (customPresets.state === 'connected') await customPresets.reload();
      else await customPresets.connect();
    } catch (error) {
      if (error.name !== 'AbortError') {
        folderText.textContent = t('browser.folder.openFailed', { error: error.message });
        return;
      }
    }
    refreshFolder();
  });

  folderOpen.addEventListener('click', () => folderFiles.click());
  folderFiles.addEventListener('change', async () => {
    const files = [...folderFiles.files];
    folderFiles.value = ''; // so the same file can be opened again later
    if (!files.length) return;
    const backups = files.filter((file) => /\.json$/i.test(file.name));
    const parts = [];
    const failed = [];
    for (const file of backups) {
      try {
        const added = library.merge(JSON.parse(await file.text()));
        parts.push(t('browser.restored', added));
      } catch {
        failed.push(file.name);
      }
    }
    const presetFiles = files.filter((file) => !backups.includes(file));
    const result = presetFiles.length ? await customPresets.importFiles(presetFiles) : { imported: [], failed: [] };
    const { imported } = result;
    failed.push(...result.failed.map((entry) => entry.fileName));
    if (imported.length) parts.push(imported.length === 1 ? t('browser.loadedOne', { name: imported[0] }) : t('browser.loadedMany', { count: imported.length }));
    if (failed.length) parts.push(t('browser.unreadable', { files: failed.join(', ') }));
    refreshFolder(parts.join(', '), failed.length > 0);
    // Show a single loaded preset right away.
    if (imported.length === 1) presetVisualizer()?.selectPreset(imported[0]);
  });

  backupButton.addEventListener('click', () => {
    const backup = library.toBackup();
    downloadText(BACKUP_FILE, `${JSON.stringify(backup, null, 2)}\n`, 'application/json');
    refreshFolder(t('browser.backedUp', { favorites: backup.favorites.length, collections: backup.collections.length, file: BACKUP_FILE }));
  });

  function showNameForm(mode, presetToAdd = null) {
    formMode = mode;
    nameForm.hidden = false;
    nameForm.dataset.preset = presetToAdd ?? '';
    nameInput.value = mode === 'rename' ? library.collections.find((entry) => entry.id === library.active)?.name ?? '' : '';
    nameInput.placeholder = t(mode === 'rename' ? 'browser.newName' : 'browser.collectionName');
    nameInput.focus();
  }

  function hideNameForm() {
    nameForm.hidden = true;
    formMode = null;
  }

  nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (formMode === 'rename') library.renameCollection(library.active, nameInput.value);
    if (formMode === 'create') {
      const id = library.createCollection(nameInput.value);
      if (id && nameForm.dataset.preset) library.toggle(id, nameForm.dataset.preset);
      else if (id) library.setActive(id);
    }
    hideNameForm();
  });
  nameForm.querySelector('[data-action="cancel"]').addEventListener('click', hideNameForm);

  panel.querySelector('#pb-create').addEventListener('click', () => showNameForm('create'));
  renameButton.addEventListener('click', () => showNameForm('rename'));
  deleteButton.addEventListener('click', () => {
    const current = library.collections.find((entry) => entry.id === library.active);
    if (current && !current.builtIn && confirm(t('browser.confirmDelete', { name: current.name }))) {
      library.deleteCollection(current.id);
    }
  });
  collectionSelect.addEventListener('change', () => {
    search.value = '';
    library.setActive(collectionSelect.value);
    renderList();
  });
  search.addEventListener('input', renderList);
  panel.querySelector('#pb-close').addEventListener('click', () => close());

  onLanguageChange(() => {
    fillCollections();
    updateRow();
    shownKey = '';
    if (open) renderList({ jumpToPlaying: false });
    refreshFolder();
  });

  function show() {
    if (!presetVisualizer()) return;
    open = true;
    panel.hidden = false;
    browseButton.setAttribute('aria-expanded', 'true');
    loadPreviews();
    refreshFolder();
    fillCollections();
    // The list is kept when closing and only rebuilt when its content has changed.
    // Rebuilding all entries took about 40 ms when opening and made Milkdrop stall briefly.
    renderList();
    onChange();
  }

  function close() {
    if (!open) return;
    open = false;
    // Otherwise the focus stays briefly in the hidden search field, and the next key (such as V) counts as typing.
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.hidden = true;
    closeMenu();
    hideNameForm();
    browseButton.setAttribute('aria-expanded', 'false');
    onChange();
  }

  favoriteButton.addEventListener('click', () => {
    const visualizer = presetVisualizer();
    if (visualizer) library.toggleFavorite(visualizer.presetName);
  });
  row.querySelector('#hud-prev').addEventListener('click', () => {
    presetVisualizer()?.previousPreset();
    onChange();
  });
  row.querySelector('#hud-next').addEventListener('click', () => {
    presetVisualizer()?.nextPreset();
    onChange();
  });
  browseButton.addEventListener('click', () => (open ? close() : show()));

  // A click outside closes menu and list. Clicks in the HUD, the list and the editor next to it do not count as outside.
  window.addEventListener('pointerdown', (event) => {
    if (openMenu && !openMenu.contains(event.target) && !event.target.closest('.pb-add')) closeMenu();
    if (open && !panel.contains(event.target) && !hud.contains(event.target) && !event.target.closest('.preset-editor')) close();
  });

  library.onChange(() => {
    updateRow();
    if (open) {
      fillCollections();
      renderList({ jumpToPlaying: false });
    }
  });

  return {
    get open() {
      return open;
    },
    toggle: () => (open ? close() : show()),
    close,
    // After reading or saving own presets.
    refreshFolder() {
      refreshFolder();
      if (open) {
        fillCollections();
        shownKey = '';
        renderList({ jumpToPlaying: false });
      }
    },
    // Call after every change of visualizer or preset.
    update() {
      updateRow();
      if (!open) return;
      markPlaying();
    },
  };
}

// Choosing a preset by its picture: a grid of preview images with search. Used by the visconf editor to give a change
// a fixed preset. Each tile can also get a nickname (✎), which is then shown instead of the long name.
import { t } from '../i18n/i18n.js';
import { parsePresetName } from './preset-library.js';
import { MAX_NICKNAME_LENGTH, loadPreviews, previewImage } from './preset-previews.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPresetPicker({ root, getNames, nicknames, onPick, onClose }) {
  const search = root.querySelector('.vc-picker-search');
  const grid = root.querySelector('.vc-picker-grid');
  const count = root.querySelector('.vc-picker-count');
  let previews = null;
  let selected = null;
  let open = false;

  const label = (name) => nicknames?.get(name) || parsePresetName(name).title;

  function tileFor(name) {
    const tile = element('div', 'vc-tile');
    tile.dataset.name = name;
    if (name === selected) tile.classList.add('is-selected');
    const choose = element('button', 'vc-tile-choose');
    choose.type = 'button';
    choose.title = name;
    const thumb = element('span', 'vc-tile-thumb');
    thumb.style.backgroundImage = previewImage(previews, name);
    const text = element('span', 'vc-tile-name', label(name));
    choose.append(thumb, text);
    choose.addEventListener('click', () => {
      onPick(name);
      close();
    });
    const rename = element('button', 'vc-tile-rename', '✎');
    rename.type = 'button';
    rename.title = t('visconf.nicknameTitle');
    rename.setAttribute('aria-label', t('visconf.nicknameFor', { name }));
    rename.addEventListener('click', () => editNickname(tile, name));
    tile.append(choose, rename);
    return tile;
  }

  // The name below the picture turns into a text field. Enter or leaving it saves, Escape cancels, empty removes.
  function editNickname(tile, name) {
    const text = tile.querySelector('.vc-tile-name');
    const input = element('input', 'vc-tile-nickname');
    input.type = 'text';
    input.maxLength = MAX_NICKNAME_LENGTH;
    input.value = nicknames.get(name);
    input.placeholder = parsePresetName(name).title;
    input.setAttribute('aria-label', t('visconf.nicknameFor', { name }));
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) nicknames.set(name, input.value);
      text.textContent = label(name);
      text.hidden = false;
      input.remove();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    // Next to the button, not inside it: in a button, the space bar would choose the preset.
    text.hidden = true;
    tile.querySelector('.vc-tile-choose').after(input);
    input.focus();
    input.select();
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const names = getNames();
    const shown = query ? names.filter((name) => (nicknames ? nicknames.matches(name, query) : name.toLowerCase().includes(query))) : names;
    grid.replaceChildren(...shown.map(tileFor));
    count.textContent = t('visconf.pickerCount', { shown: shown.length, all: names.length });
  }

  search.addEventListener('input', render);
  root.querySelector('.vc-picker-close').addEventListener('click', () => close());
  // Escape closes only the picker, not the whole editor.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });

  function close() {
    if (!open) return;
    open = false;
    root.hidden = true;
    if (root.contains(document.activeElement)) document.activeElement.blur();
    onClose?.();
  }

  return {
    get open() {
      return open;
    },
    // `current`: the preset chosen so far; it is marked and scrolled into view.
    async show(current = null) {
      open = true;
      selected = current;
      root.hidden = false;
      // The picker fills the space above the editor, up to 16 px from the top of the window.
      root.style.maxHeight = `${Math.max(160, Math.min(600, root.offsetParent.getBoundingClientRect().top - 24))}px`;
      search.value = '';
      render();
      search.focus();
      grid.querySelector('.is-selected')?.scrollIntoView({ block: 'center' });
      if (!previews) {
        previews = await loadPreviews();
        if (open) {
          render();
          grid.querySelector('.is-selected')?.scrollIntoView({ block: 'center' });
        }
      }
    },
    close,
  };
}

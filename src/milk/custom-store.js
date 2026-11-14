// Access to the presets folder via the File System Access API.
// The folder is chosen once (needs a click), and the access is remembered in IndexedDB. After a restart
// of Chrome the browser may ask again; that also needs a click.
// Subfolders: own/ for new presets, edited/ for variations of other presets.
// Earlier versions used the German names eigene/ and bearbeitet/. They are still read, and files there are
// saved back in place, but new files always go to own/ and edited/.
import { t } from '../i18n/i18n.js';

export const OWN_FOLDER = 'own';
export const EDITED_FOLDER = 'edited';
export const FOLDERS = [OWN_FOLDER, EDITED_FOLDER, 'eigene', 'bearbeitet'];

//
// Without the File System Access API (Brave has turned it off) the files stay in the extension's storage (IndexedDB),
// state 'browser'. When saving, the editor also downloads the file, so it can end up in the presets folder.
// Note: if the extension is removed or imported again, this storage is empty. The downloaded files
// remain, and "Open files" brings them back.
export const browserHint = () => t(typeof navigator !== 'undefined' && navigator.brave ? 'store.braveHint' : 'store.browserHint');

const DB_NAME = 'custom-milk';
const DB_STORE = 'handles';
const FILES_STORE = 'files'; // only in state 'browser': key "folder/file.milk" → { folder, fileName, text }
const HANDLE_KEY = 'root';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const name of [DB_STORE, FILES_STORE]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // If another window of the extension still holds the old version open, do not wait forever.
    request.onblocked = () => reject(new Error(t('store.blocked')));
  });
}

async function withStore(mode, action, storeName = DB_STORE) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const loadHandle = () => withStore('readonly', (store) => store.get(HANDLE_KEY)).catch(() => null);
const saveHandle = (handle) => withStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
const listBrowserFiles = () => withStore('readonly', (store) => store.getAll(), FILES_STORE);
const putBrowserFile = (folder, fileName, text) => withStore('readwrite', (store) => store.put({ folder, fileName, text }, `${folder}/${fileName}`), FILES_STORE);

// States: 'browser' (no showDirectoryPicker, files in IndexedDB), 'none' (no folder yet), 'prompt' (remembered, but Chrome wants
// a confirmation by click), 'connected'.
export function createCustomStore() {
  let root = null;
  let state = typeof window.showDirectoryPicker === 'function' ? 'none' : 'browser';

  async function permission(handle, ask) {
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission?.(options)) === 'granted') return true;
    if (!ask) return false;
    return (await handle.requestPermission?.(options)) === 'granted';
  }

  return {
    get state() {
      return state;
    },
    get folderName() {
      return root?.name ?? '';
    },
    // Reuse the remembered folder without asking. Returns true if access is granted.
    async restore() {
      if (state === 'connected' || state === 'browser') return true;
      const handle = await loadHandle();
      if (!handle) return false;
      root = handle;
      state = (await permission(handle, false)) ? 'connected' : 'prompt';
      return state === 'connected';
    },
    // Call from a click: confirms the remembered folder or lets the user choose a new one.
    async connect({ chooseNew = false } = {}) {
      if (state === 'browser') return true;
      if (root && !chooseNew && (await permission(root, true))) {
        state = 'connected';
        return true;
      }
      const handle = await window.showDirectoryPicker({ id: 'custom-milk', mode: 'readwrite' });
      root = handle;
      state = 'connected';
      await saveHandle(handle).catch((error) => console.warn('Could not remember the folder:', error));
      return true;
    },
    // For tests: set a folder directly and remember it, for example the private file system of navigator.storage.
    async useDirectory(handle) {
      root = handle;
      state = 'connected';
      await saveHandle(handle);
    },
    // All .milk files in the preset subfolders (in state 'browser' from IndexedDB).
    async list() {
      if (state === 'browser') return (await listBrowserFiles()).filter(({ folder }) => FOLDERS.includes(folder));
      if (state !== 'connected') return [];
      const entries = [];
      for (const folder of FOLDERS) {
        let directory;
        try {
          directory = await root.getDirectoryHandle(folder);
        } catch {
          continue; // the folder does not exist yet
        }
        for await (const [fileName, handle] of directory.entries()) {
          if (handle.kind === 'file' && /\.milk$/i.test(fileName)) entries.push({ folder, fileName, handle });
        }
      }
      return entries;
    },
    async read(entry) {
      return entry.handle ? (await entry.handle.getFile()).text() : entry.text;
    },
    async write(folder, fileName, text) {
      if (state === 'browser') return putBrowserFile(folder, fileName, text);
      if (state !== 'connected') throw new Error(t('store.notConnected'));
      const directory = await root.getDirectoryHandle(folder, { create: true });
      const file = await directory.getFileHandle(fileName, { create: true });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
    },
  };
}

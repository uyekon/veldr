const DB_NAME = 'noteflow-editor';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;

export const draftKeyFor = (noteId) => (noteId ? `note:${noteId}` : 'new');

export const createDraftRecord = (payload = {}) => ({
  key: draftKeyFor(payload.noteId),
  noteId: payload.noteId || null,
  title: String(payload.title || ''),
  desc: String(payload.desc || ''),
  category: String(payload.category || ''),
  tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
  content: String(payload.content || ''),
  notebookId: payload.notebookId || null,
  serverVersion: Number(payload.serverVersion) || null,
  serverUpdatedAt: payload.serverUpdatedAt || null,
  updatedAt: Number(payload.updatedAt) || Date.now(),
});

export const isDraftNewerThanNote = (draft, note) => {
  if (!draft?.updatedAt) return false;
  if (!note) return true;
  const serverUpdatedAt = Date.parse(note.updatedAt || '') || 0;
  return Number(draft.updatedAt) > serverUpdatedAt;
};

const openDraftDB = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) {
    reject(new Error('IndexedDB is unavailable'));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Unable to open draft storage'));
});

const withStore = async (mode, action) => {
  const db = await openDraftDB();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || request?.error || new Error('Draft storage failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Draft storage aborted'));
    });
  } finally {
    db.close();
  }
};

export const loadDraft = async (noteId) => withStore('readonly', (store) => store.get(draftKeyFor(noteId)));
export const saveDraft = async (draft) => withStore('readwrite', (store) => store.put(createDraftRecord(draft)));
export const removeDraft = async (noteId) => withStore('readwrite', (store) => store.delete(draftKeyFor(noteId)));

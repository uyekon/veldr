import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withCmsLock } from './cmsLock.js';
import { loadPostgresDB, persistPostgresDB, withPostgresTransaction } from './cmsPostgresStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

const resolveFromBackend = (targetPath) => path.resolve(backendRoot, targetPath);

const dataDir = resolveFromBackend(config.cms.dataDir);
const uploadDir = resolveFromBackend(config.cms.uploadDir);
const dbFile = path.join(dataDir, config.cms.dbFile);

const repairFilenameEncoding = (name) => {
  const value = String(name || '');
  if (!/[\u00c0-\u00ff]/.test(value)) return value;
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return decoded.includes('\ufffd') ? value : decoded;
  } catch { return value; }
};

let db = null;
let writeChain = Promise.resolve();
const transaction = new AsyncLocalStorage();
let operationChain = Promise.resolve();
let loadingPromise = null;

// All runtime writers must enter this queue; readers see committed snapshots only.
const withTransaction = (operation) => {
  if (config.cms.store === 'postgres') return withPostgresTransaction(operation);
  if (transaction.getStore()) return operation();
  const pending = operationChain.catch(() => {}).then(() => withCmsLock(dataDir, async () => {
    const draft = structuredClone(await loadDB());
    return transaction.run({ draft }, operation);
  }));
  operationChain = pending.catch(() => {});
  return pending;
};

const whiteboardIds = ['t', 'b', 'w', 'dp', 'n'];
const canonicalWhiteboardId = (id) => id === 'dailyPush' ? 'dp' : id;

const whiteboardNames = {
  t: '白板',
  b: '白板 B',
  w: '白板 W',
  dp: '每日推送',
  n: '日记',
};

const defaultWhiteboard = (id) => ({ id, content: '', version: 1, updatedAt: null, archives: [] });

const normalizeWhiteboard = (id, whiteboard) => ({
  id,
  content: typeof whiteboard?.content === 'string' ? whiteboard.content : '',
  version: Number(whiteboard?.version) || 1,
  updatedAt: whiteboard?.updatedAt || null,
  archives: Array.isArray(whiteboard?.archives) ? whiteboard.archives.slice(-100) : [],
});

const legacyWhiteboard = (whiteboard) => ({
  content: whiteboard.content,
  version: whiteboard.version,
  updatedAt: whiteboard.updatedAt,
});

const defaultDB = () => ({
  notes: [],
  categories: [
    { id: 'work', label: '工作', notebookId: [] },
    { id: 'learn', label: '学习', notebookId: [] },
    { id: 'uncategorized', label: '未分类', notebookId: [] },
  ],
  menus: [
    { id: 'docs', label: 'Docs', type: 'docs' },
  ],
  whiteboards: whiteboardIds.map(defaultWhiteboard),
  whiteboard: legacyWhiteboard(defaultWhiteboard('t')),
  media: [],
});

const normalizeWhiteboards = (database) => {
  const storedWhiteboards = Array.isArray(database.whiteboards) ? database.whiteboards : [];
  database.whiteboards = whiteboardIds.map((id) => {
    const stored = storedWhiteboards.find((whiteboard) => canonicalWhiteboardId(whiteboard?.id) === id);
    return normalizeWhiteboard(id, stored || (id === 't' ? database.whiteboard : null));
  });
  database.whiteboard = legacyWhiteboard(database.whiteboards[0]);
};

const ensureRuntimeDirs = async () => {
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(uploadDir, { recursive: true });
};

const readDB = async () => {
  if (transaction.getStore()) return transaction.getStore().draft;
  if (db) {
    return structuredClone(db);
  }

  await ensureRuntimeDirs();

  try {
    const raw = await fsp.readFile(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      ['notes', 'categories', 'menus', 'whiteboards', 'media'].some(key => parsed[key] !== undefined &&
        (!Array.isArray(parsed[key]) || parsed[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))))) {
      throw new Error('Invalid CMS database; restore a verified backup');
    }
    // Never silently discard either record if an imported database contains
    // both IDs. Normal migration has exactly one legacy record.
    if (parsed.whiteboards?.some(board => board.id === 'dp') && parsed.whiteboards.some(board => board.id === 'dailyPush')) {
      throw new Error('Both dp and dailyPush exist; reconcile these whiteboards before loading');
    }
    db = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = defaultDB();
    try { await persistDB(); } catch (writeError) { db = null; throw writeError; }
  }

  if (!db || typeof db !== 'object' || Array.isArray(db)) {
    db = null;
    throw new Error('Invalid CMS database; restore a verified backup');
  }

  if (!Array.isArray(db.notes)) db.notes = [];
  db.notes = db.notes.map(note => ({
    ...note,
    desc: typeof note.desc === 'string' ? note.desc : '',
    pinned: Boolean(note.pinned),
  }));
  if (!Array.isArray(db.categories)) db.categories = defaultDB().categories;
  db.categories = db.categories.map(category => {
  const nb = category.notebookId;
  const notebookId = Array.isArray(nb) ? nb : (typeof nb === 'string' && nb ? [nb] : []);
  return { ...category, parentId: category.parentId || null, notebookId };
});
  if (!Array.isArray(db.menus)) db.menus = [];
  normalizeWhiteboards(db);
  if (!Array.isArray(db.media)) db.media = [];
  db.media = db.media.map(item => ({ ...item, originalName: repairFilenameEncoding(item.originalName) }));
  return structuredClone(db);
};

const loadDB = async () => {
  if (config.cms.store === 'postgres') return loadPostgresDB();
  if (transaction.getStore()) return transaction.getStore().draft;
  if (loadingPromise) return structuredClone(await loadingPromise);
  if (db) return structuredClone(db);
  if (!loadingPromise) loadingPromise = readDB().finally(() => { loadingPromise = null; });
  return structuredClone(await loadingPromise);
};

const persistDB = async () => {
  if (config.cms.store === 'postgres') return persistPostgresDB();
  await ensureRuntimeDirs();
  const tmp = `${dbFile}.tmp`;
  const snapshot = structuredClone(transaction.getStore()?.draft || db || defaultDB());
  const json = JSON.stringify(snapshot, null, 2);

  // .catch(() => {}) keeps one failed write from poisoning every later persist;
  // the failure still rejects this call's returned promise below
  const write = writeChain
    .catch(() => {})
    .then(async () => {
      const file = await fsp.open(tmp, 'w', 0o600);
      try { await file.writeFile(json); await file.sync(); } finally { await file.close(); }
      await fsp.rename(tmp, dbFile);
      db = snapshot;
    });

  writeChain = write;
  return write;
};

const resetDBForTests = (nextDB = null) => {
  db = nextDB;
  if (db) { normalizeWhiteboards(db); if (!Array.isArray(db.media)) db.media = []; }
  writeChain = Promise.resolve();
  operationChain = Promise.resolve();
  loadingPromise = null;
};

const nextId = (items) => items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return tags.map(tag => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(tag => tag.trim()).filter(Boolean);
  return [];
};

export {
  dataDir,
  uploadDir,
  dbFile,
  loadDB,
  persistDB,
  withTransaction,
  resetDBForTests,
  nextId,
  normalizeTags,
  whiteboardIds,
  canonicalWhiteboardId,
  whiteboardNames,
};

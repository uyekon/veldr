import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';

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

const defaultDB = () => ({
  notes: [],
  categories: [
    { id: 'work', label: '工作' },
    { id: 'learn', label: '学习' },
  ],
  menus: [
    { id: 'docs', label: 'Docs', type: 'docs' },
  ],
  media: [],
});

const ensureRuntimeDirs = async () => {
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(uploadDir, { recursive: true });
};

const loadDB = async () => {
  if (db) return db;

  await ensureRuntimeDirs();

  try {
    const raw = await fsp.readFile(dbFile, 'utf8');
    db = JSON.parse(raw);
  } catch {
    db = defaultDB();
    await persistDB();
  }

  if (!Array.isArray(db.notes)) db.notes = [];
  if (!Array.isArray(db.categories)) db.categories = defaultDB().categories;
  if (!Array.isArray(db.menus)) db.menus = [];
  if (!Array.isArray(db.media)) db.media = [];
  db.media = db.media.map(item => ({ ...item, originalName: repairFilenameEncoding(item.originalName) }));
  return db;
};

const persistDB = async () => {
  await ensureRuntimeDirs();
  const tmp = `${dbFile}.tmp`;
  const json = JSON.stringify(db || defaultDB(), null, 2);

  // .catch(() => {}) keeps one failed write from poisoning every later persist;
  // the failure still rejects this call's returned promise below
  const write = writeChain
    .catch(() => {})
    .then(() => fsp.writeFile(tmp, json))
    .then(() => fsp.rename(tmp, dbFile));

  writeChain = write;
  return write;
};

const resetDBForTests = (nextDB = null) => {
  db = nextDB;
  writeChain = Promise.resolve();
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
  resetDBForTests,
  nextId,
  normalizeTags,
};

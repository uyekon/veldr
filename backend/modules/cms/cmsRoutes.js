import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { attachAuthState } from '../../middleware/auth.js';
import { asyncHandler as handleAsync } from '../../middleware/errorHandler.js';
import { loadDB, persistDB, withTransaction, nextId, normalizeTags, uploadDir, whiteboardIds, whiteboardNames } from './cmsStore.js';
import { createHash } from 'node:crypto';
import { noteMarkdown, exportAllNotes } from './cmsExport.js';
import { requireEditor, requireViewer } from './cmsAuth.js';
import { cleanupUnreferencedCmsUploads, extractCmsUploadFilenames } from './cmsImages.js';
import { cleanupCmsUploads } from './cmsMaintenance.js';

const router = express.Router();
const execFileAsync = promisify(execFile);

const send = (res, status, data) => res.status(status).json(data);
const asyncHandler = (handler) => handleAsync((req, res, next) => (
  ['GET', 'HEAD'].includes(req.method) ? handler(req, res, next)
    : withTransaction(() => handler(req, res, next))
));

// Async middleware/handlers must be wrapped so rejections reach errorHandler
// instead of becoming unhandled rejections (which kill the process in server.js)
const viewer = handleAsync(requireViewer);
const editor = handleAsync(requireEditor);

const allowedImages = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)$/i;
const allowedVideos = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const videoUploadDir = path.join(uploadDir, 'videos');
const videoPosterDir = path.join(uploadDir, 'video-posters');
const nowIso = () => new Date().toISOString();
const noteVersion = (note) => Number(note.version) || 1;
const safeCategoryId = (label) => String(label || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9一-龥]+/g, '-')
  .replace(/^-+|-+$/g, '')
  || `category-${Date.now()}`;

const markdownExcerpt = (content) => String(content || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*\d+\.\s+/gm, '')
  .replace(/^\s*>\s?/gm, '')
  .replace(/[*_`~|[\]()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);
const normalizeDescription = (value) => String(value || '').trim().slice(0, 500);
const normalizeNotebookIds = (value) => [...new Set((Array.isArray(value) ? value : [value])
  .map((id) => String(id || '').trim())
  .filter(Boolean))];

// An empty notebookId array means that a category is global. A child may keep
// that global scope only when its parent is global; otherwise it must use a
// non-empty subset of the parent's scope.
const isCategoryScopeWithinParent = (scope, parentScope) => (
  parentScope.length === 0 || (scope.length > 0 && scope.every((id) => parentScope.includes(id)))
);

const getCategoryAncestorIds = (categories, categoryId) => {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const ids = [];
  const seen = new Set();
  let currentId = categoryId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const category = categoryById.get(currentId);
    if (!category) break;
    ids.push(category.id);
    currentId = category.parentId || null;
  }
  return ids;
};

const wouldCreateCategoryCycle = (categories, categoryId, parentId) => (
  getCategoryAncestorIds(categories, parentId).includes(categoryId)
);

// Note saves are also a safe repair path for old data. Restricted categories
// collect the note's notebook on themselves and every ancestor. Global
// categories stay global: [] already means they are available in every
// notebook and must not accidentally become restricted to one notebook.
const bindNotebookToCategoryAncestors = (db, categoryId, notebookId) => {
  const normalizedNotebookId = String(notebookId || '').trim();
  if (!normalizedNotebookId) return;
  const indexes = new Map(db.categories.map((category, index) => [category.id, index]));
  getCategoryAncestorIds(db.categories, categoryId).forEach((id) => {
    const index = indexes.get(id);
    if (index === undefined) return;
    const category = db.categories[index];
    const currentScope = normalizeNotebookIds(category.notebookId);
    if (currentScope.length === 0 || currentScope.includes(normalizedNotebookId)) return;
    db.categories[index] = { ...category, notebookId: [...currentScope, normalizedNotebookId] };
  });
};

const normalizeNoteMeta = (note) => ({
  version: noteVersion(note),
  createdAt: note.createdAt || (note.date ? `${note.date}T00:00:00.000Z` : nowIso()),
  updatedAt: note.updatedAt || (note.date ? `${note.date}T00:00:00.000Z` : nowIso()),
});

// 带 private 标签的笔记仅编辑角色可见（大小写不敏感）
const isPrivateNote = (note) => (Array.isArray(note.tags) ? note.tags : [])
  .some(tag => String(tag).trim().toLowerCase() === 'private');
const isArchivedNote = (note) => (Array.isArray(note.tags) ? note.tags : [])
  .some(tag => String(tag).trim().toLowerCase() === 'archived');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      const base = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, base + (ext || '.img'));
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedImages.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(videoUploadDir, { recursive: true }); cb(null, videoUploadDir); },
    filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}${path.extname(file.originalname).toLowerCase() || '.mp4'}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, allowedVideos.has(file.mimetype)),
});

const decodeUploadName = (name) => {
  const value = String(name || '');
  if (!/[\u00c0-\u00ff]/.test(value)) return value;
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return decoded.includes('\ufffd') ? value : decoded;
  } catch { return value; }
};

const probeVideo = async (filename) => {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filename], { maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  const stream = (data.streams || []).find((item) => item.codec_type === 'video');
  const duration = Number(data.format?.duration || 0);
  if (!stream || !duration || duration > 600) throw new Error('Video must contain a picture stream and be no longer than 10 minutes');
  return { duration: Math.round(duration), width: Number(stream.width || 0), height: Number(stream.height || 0) };
};

const referenceDocuments = (db) => [...db.notes, ...db.whiteboards, ...db.menus,
  ...db.whiteboards.flatMap(board => board.archives || [])];
const isVideoReferenced = (db, filename) => referenceDocuments(db).some((note) => String(note.content || '').includes(`/uploads/cms/videos/${filename}`));

router.use(attachAuthState);

router.get('/me', viewer, (req, res) => {
  send(res, 200, { role: req.cmsRole });
});

const publicWhiteboard = (whiteboard) => ({
  id: whiteboard.id,
  name: whiteboardNames[whiteboard.id] || whiteboard.id,
  content: whiteboard.content,
  version: whiteboard.version,
  updatedAt: whiteboard.updatedAt,
  archives: Array.isArray(whiteboard.archives)
    ? whiteboard.archives
      .filter((archive) => archive && typeof archive === 'object')
      .map(({ id, title, version, createdAt }) => ({ id, title, version, createdAt }))
    : [],
});

const legacyWhiteboard = (whiteboard) => ({
  content: whiteboard.content,
  version: whiteboard.version,
  updatedAt: whiteboard.updatedAt,
});

const findWhiteboard = (db, id) => db.whiteboards.find((whiteboard) => whiteboard.id === id);

const updateWhiteboard = async (req, res, id, legacyResponse = false) => {
  const db = await loadDB();
  const body = req.body || {};
  if (typeof body.content !== 'string') return send(res, 400, { error: 'Whiteboard content must be text' });
  if (body.content.length > 200000) return send(res, 400, { error: 'Whiteboard content is too long' });

  const current = findWhiteboard(db, id);
  const currentVersion = Number(current.version) || 1;
  if (!body.force && body.version !== undefined && Number(body.version) !== currentVersion) {
    if (body.content === current.content) return send(res, 200, legacyResponse ? legacyWhiteboard(current) : publicWhiteboard(current));
    return send(res, 409, {
      error: 'Whiteboard was updated on another device',
      code: 'VERSION_CONFLICT',
      current: legacyResponse ? legacyWhiteboard(current) : publicWhiteboard(current),
    });
  }

  const updated = { ...current, id, content: body.content, version: currentVersion + 1, updatedAt: nowIso() };
  db.whiteboards[db.whiteboards.findIndex((whiteboard) => whiteboard.id === id)] = updated;
  if (id === 't') db.whiteboard = legacyWhiteboard(updated);
  await persistDB();
  return send(res, 200, legacyResponse ? legacyWhiteboard(updated) : publicWhiteboard(updated));
};

router.get('/whiteboards', editor, asyncHandler(async (_req, res) => {
  const db = await loadDB();
  return send(res, 200, db.whiteboards.map(({ id, updatedAt }) => ({ id, name: whiteboardNames[id] || id, updatedAt })));
}));

router.get('/whiteboards/:id', editor, asyncHandler(async (req, res) => {
  if (!whiteboardIds.includes(req.params.id)) return send(res, 404, { error: 'Whiteboard not found' });
  const whiteboard = findWhiteboard(await loadDB(), req.params.id);
  return send(res, 200, publicWhiteboard(whiteboard));
}));

router.put('/whiteboards/:id', editor, asyncHandler(async (req, res) => {
  if (!whiteboardIds.includes(req.params.id)) return send(res, 404, { error: 'Whiteboard not found' });
  return updateWhiteboard(req, res, req.params.id);
}));

router.post('/whiteboards/n/archive', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const body = req.body || {};
  if (!Number.isInteger(body.version) || body.version < 1 || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId || '')) {
    return send(res, 400, { error: '请刷新页面后重试：缺少版本或请求标识' });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    body.version, body.title, body.notebookId, body.category, normalizeTags(body.tags), body.desc || '', body.date || '',
  ])).digest('hex');
  db.diaryConversions ||= {};
  if (Object.hasOwn(db.diaryConversions, body.requestId)) {
    const saved = db.diaryConversions[body.requestId];
    if (saved.fingerprint !== fingerprint) return send(res, 409, { error: '请求标识已用于其他转换', code: 'REQUEST_CONFLICT' });
    return send(res, 200, { ...saved.result, replayed: true, whiteboard: publicWhiteboard(findWhiteboard(db, 'n')) });
  }
  const whiteboard = findWhiteboard(db, 'n');
  if (body.version !== whiteboard.version) return send(res, 409, {
    error: '日记已更新，请重新加载并确认内容', code: 'VERSION_CONFLICT', current: publicWhiteboard(whiteboard),
  });
  const title = String(body.title || '').trim();
  const content = String(whiteboard.content || '');
  const notebookId = String(body.notebookId || '').trim();
  if (!title || !content.trim()) return send(res, 400, { error: 'Title and diary content are required' });
  if (!notebookId || !db.menus.some(menu => menu.id === notebookId && menu.type === 'notebook')) {
    return send(res, 400, { error: 'A valid notebook is required' });
  }
  const category = String(body.category || '').trim() || db.categories[0]?.id || 'work';
  if (!db.categories.some(item => item.id === category)) return send(res, 400, { error: 'Category not found' });
  if (getCategoryAncestorIds(db.categories, category).some(id => {
    const scope = normalizeNotebookIds(db.categories.find(item => item.id === id).notebookId);
    return scope.length && !scope.includes(notebookId);
  })) return send(res, 400, { error: '分类不属于所选 Notebook' });
  const timestamp = nowIso();
  const note = {
    id: nextId(db.notes), title: title.slice(0, 200), category, notebookId,
    tags: normalizeTags(body.tags), date: body.date || timestamp.split('T')[0],
    readTime: `${Math.max(1, Math.ceil(content.length / 500))} min`,
    excerpt: markdownExcerpt(content), desc: normalizeDescription(body.desc),
    starred: false, pinned: false, content, version: 1,
    createdAt: timestamp, updatedAt: timestamp,
  };
  bindNotebookToCategoryAncestors(db, category, notebookId);
  db.notes.unshift(note);
  whiteboard.content = '';
  whiteboard.version = (Number(whiteboard.version) || 1) + 1;
  whiteboard.updatedAt = timestamp;
  db.diaryConversions[body.requestId] = { fingerprint, result: { note, whiteboard: publicWhiteboard(whiteboard) } };
  await persistDB();
  return send(res, 201, { note, whiteboard: publicWhiteboard(whiteboard) });
}));

router.get('/whiteboard', editor, asyncHandler(async (_req, res) => {
  const whiteboard = findWhiteboard(await loadDB(), 't');
  return send(res, 200, legacyWhiteboard(whiteboard));
}));

router.put('/whiteboard', editor, asyncHandler(async (req, res) => updateWhiteboard(req, res, 't', true)));

router.get('/notes', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  let notes = db.notes.map(note => ({ ...note, ...normalizeNoteMeta(note) }));
  if (req.cmsRole !== 'editor') notes = notes.filter(note => !isPrivateNote(note));
  const { category, tag, search, star, notebookId, includeArchived } = req.query;

  if (includeArchived !== '1' && tag !== 'archived') notes = notes.filter(note => !isArchivedNote(note));
  if (tag === 'archived') notes = notes.filter(note => isArchivedNote(note));

  if (notebookId) notes = notes.filter(note => note.notebookId === notebookId);
  if (category) notes = notes.filter(note => note.category === category);
  if (tag && tag !== 'archived') notes = notes.filter(note => Array.isArray(note.tags) && note.tags.includes(tag));
  if (star === '1' || star === 'true') notes = notes.filter(note => note.starred);
  if (search) {
    const query = String(search).toLowerCase();
    notes = notes.filter(note =>
      (note.title || '').toLowerCase().includes(query) ||
      (note.desc || '').toLowerCase().includes(query) ||
      (note.excerpt || '').toLowerCase().includes(query) ||
      (note.content || '').toLowerCase().includes(query) ||
      (note.tags || []).some(tagValue => String(tagValue).toLowerCase().includes(query))
    );
  }

  send(res, 200, notes);
}));

router.get('/export', editor, asyncHandler(async (_req, res, next) => {
  const archive = await exportAllNotes();
  res.download(archive.file, 'noteflow-notes.zip', error => {
    void archive.cleanup();
    if (error && !res.headersSent) next(error);
  });
}));

router.get('/notes/:id/export', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const note = db.notes.find(item => item.id === Number(req.params.id));
  if (!note) return send(res, 404, { error: 'Note not found' });
  res.attachment(`note-${note.id}.md`).type('text/markdown').send(noteMarkdown(note, db));
}));

router.get('/notes/:id', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const note = db.notes.find(item => item.id === Number(req.params.id));
  // private 笔记对非编辑角色返回 404，不泄露其存在
  if (!note || (req.cmsRole !== 'editor' && isPrivateNote(note))) {
    return send(res, 404, { error: 'Note not found' });
  }
  return send(res, 200, { ...note, ...normalizeNoteMeta(note) });
}));

router.post('/notes', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const body = req.body || {};
  if (!body.title || !body.content) {
    return send(res, 400, { error: 'Title and content are required' });
  }

  const content = String(body.content);
  const desc = normalizeDescription(body.desc);
  const timestamp = nowIso();
  // Ensure every note has a notebook; default to the first available notebook.
  const defaultNotebookId = db.menus.find(m => m.type === 'notebook')?.id || null;
  const note = {
    id: nextId(db.notes),
    title: String(body.title),
    // Default to the first existing category; fall back to 'work' only as last resort.
    category: (body.category && String(body.category).trim()) ? String(body.category).trim() : (db.categories[0]?.id || 'work'),
    notebookId: (body.notebookId && String(body.notebookId).trim()) ? String(body.notebookId) : defaultNotebookId,
    tags: normalizeTags(body.tags),
    date: body.date || new Date().toISOString().split('T')[0],
    readTime: body.readTime || `${Math.max(1, Math.ceil(content.length / 500))} min`,
    excerpt: body.excerpt || markdownExcerpt(content),
    desc,
    starred: Boolean(body.starred),
    pinned: Boolean(body.pinned),
    content,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  bindNotebookToCategoryAncestors(db, note.category, note.notebookId);
  db.notes.unshift(note);
  await persistDB();
  return send(res, 201, note);
}));

router.put('/notes/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const id = Number(req.params.id);
  const index = db.notes.findIndex(note => note.id === id);
  if (index === -1) return send(res, 404, { error: 'Note not found' });

  const body = req.body || {};
  const current = db.notes[index];
  const currentVersion = noteVersion(current);
  if (!body.force && body.version !== undefined && Number(body.version) !== currentVersion) {
    return send(res, 409, {
      error: 'Note was updated on another device',
      code: 'VERSION_CONFLICT',
      current: { ...current, ...normalizeNoteMeta(current) },
    });
  }

  const content = body.content !== undefined ? String(body.content) : current.content;
  const desc = body.desc !== undefined ? normalizeDescription(body.desc) : (current.desc || '');
  const previousImages = extractCmsUploadFilenames(current.content);
  const timestamp = nowIso();
  const updated = {
    ...current,
    title: body.title !== undefined ? String(body.title) : current.title,
    category: body.category !== undefined ? body.category : current.category,
    notebookId: body.notebookId !== undefined ? (body.notebookId && String(body.notebookId).trim()) || null : current.notebookId || null,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : current.tags,
    content,
    excerpt: body.excerpt !== undefined ? body.excerpt : (body.content !== undefined ? markdownExcerpt(content) : current.excerpt),
    desc,
    starred: body.starred !== undefined ? Boolean(body.starred) : current.starred,
    pinned: body.pinned !== undefined ? Boolean(body.pinned) : Boolean(current.pinned),
    date: body.date !== undefined ? body.date : current.date,
    readTime: body.readTime !== undefined ? body.readTime : current.readTime,
    version: currentVersion + 1,
    createdAt: current.createdAt || timestamp,
    updatedAt: timestamp,
  };

  db.notes[index] = updated;
  bindNotebookToCategoryAncestors(db, updated.category, updated.notebookId);
  await persistDB();
  await cleanupUnreferencedCmsUploads({ notes: referenceDocuments(db), candidates: previousImages });
  return send(res, 200, updated);
}));

router.delete('/notes/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const id = Number(req.params.id);
  const deletedNote = db.notes.find(note => note.id === id);
  const previousImages = extractCmsUploadFilenames(deletedNote?.content);
  const before = db.notes.length;
  db.notes = db.notes.filter(note => note.id !== id);
  if (db.notes.length === before) return send(res, 404, { error: 'Note not found' });
  await persistDB();
  await cleanupUnreferencedCmsUploads({ notes: referenceDocuments(db), candidates: previousImages });
  return send(res, 200, { ok: true });
}));

router.get('/categories', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  return send(res, 200, db.categories);
}));

router.post('/categories', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const label = String(req.body?.label || '').trim();
  if (!label) return send(res, 400, { error: 'Category label is required' });

  const baseId = safeCategoryId(label);
  let id = baseId;
  let suffix = 2;
  while (db.categories.some(category => category.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const parentId = req.body?.parentId ? String(req.body.parentId) : null;
  const parent = parentId ? db.categories.find(category => category.id === parentId) : null;
  if (parentId && !parent) {
    return send(res, 400, { error: 'Parent category not found' });
  }
  const hasNotebookScope = Object.hasOwn(req.body || {}, 'notebookId');
  const notebookId = hasNotebookScope
    ? normalizeNotebookIds(req.body.notebookId)
    : normalizeNotebookIds(parent?.notebookId);
  if (parent && !isCategoryScopeWithinParent(notebookId, normalizeNotebookIds(parent.notebookId))) {
    return send(res, 400, { error: 'Subcategory notebook scope must be within its parent category' });
  }
  const category = { id, label, parentId, notebookId };
  db.categories.push(category);
  await persistDB();
  return send(res, 201, category);
}));

router.put('/categories/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const index = db.categories.findIndex(category => category.id === req.params.id);
  if (index === -1) return send(res, 404, { error: 'Category not found' });

  const label = String(req.body?.label || '').trim();
  if (!label) return send(res, 400, { error: 'Category label is required' });

  const parentId = req.body?.parentId === undefined ? db.categories[index].parentId || null : (req.body.parentId ? String(req.body.parentId) : null);
  const parent = parentId ? db.categories.find(category => category.id === parentId) : null;
  if (parentId && (!parent || wouldCreateCategoryCycle(db.categories, req.params.id, parentId))) {
    return send(res, 400, { error: 'Invalid parent category' });
  }
  const notebookId = req.body?.notebookId === undefined
    ? normalizeNotebookIds(db.categories[index].notebookId)
    : normalizeNotebookIds(req.body.notebookId);
  if (parent && !isCategoryScopeWithinParent(notebookId, normalizeNotebookIds(parent.notebookId))) {
    return send(res, 400, { error: 'Subcategory notebook scope must be within its parent category' });
  }
  db.categories[index] = { ...db.categories[index], label, parentId, notebookId };
  await persistDB();
  return send(res, 200, db.categories[index]);
}));

router.delete('/categories/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  if (db.categories.length <= 1) return send(res, 400, { error: 'At least one category is required' });
  const index = db.categories.findIndex(category => category.id === id);
  if (index === -1) return send(res, 404, { error: 'Category not found' });

  // Prefer 'uncategorized' as fallback so deleted categories' notes
  // don't randomly land in an arbitrary sibling category.
  const fallback = db.categories.find(category => category.id === 'uncategorized' && category.id !== id)?.id
    ?? db.categories.find(category => category.id !== id)?.id
    ?? 'work';
  const parentId = db.categories[index].parentId || null;
  db.categories = db.categories.filter(category => category.id !== id);
  db.categories = db.categories.map(category => category.parentId === id ? { ...category, parentId } : category);
  db.notes = db.notes.map(note => (
    note.category === id ? { ...note, category: fallback } : note
  ));
  await persistDB();
  return send(res, 200, { ok: true, fallback });
}));

router.get('/menus', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  return send(res, 200, db.menus);
}));

router.post('/menus', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const body = req.body || {};
  const label = String(body.label || '').trim();
  if (!label) return send(res, 400, { error: 'Menu label is required' });

  const menu = {
    id: `notebook_${Date.now()}`,
    label,
    type: body.type || 'notebook',
    contentKey: body.contentKey || null,
    content: body.content || null,
  };

  db.menus.push(menu);
  await persistDB();
  return send(res, 201, menu);
}));

router.put('/menus/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const index = db.menus.findIndex(menu => menu.id === req.params.id);
  if (index === -1) return send(res, 404, { error: 'Menu not found' });

  const body = req.body || {};
  db.menus[index] = {
    ...db.menus[index],
    label: body.label !== undefined ? body.label : db.menus[index].label,
    type: body.type !== undefined ? body.type : db.menus[index].type,
    contentKey: body.contentKey !== undefined ? body.contentKey : db.menus[index].contentKey,
    content: body.content !== undefined ? body.content : db.menus[index].content,
  };
  await persistDB();
  return send(res, 200, db.menus[index]);
}));

router.delete('/menus/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  if (id === 'docs') return send(res, 400, { error: 'The docs menu cannot be deleted' });

  const before = db.menus.length;
  db.menus = db.menus.filter(menu => menu.id !== id);
  if (db.menus.length === before) return send(res, 404, { error: 'Menu not found' });
  db.notes = db.notes.map(note => (
    note.notebookId === id ? { ...note, notebookId: null } : note
  ));
  await persistDB();
  return send(res, 200, { ok: true });
}));

router.get('/media', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const search = String(req.query.search || '').trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const filtered = db.media.filter((item) => !search || `${item.originalName} ${item.mime}`.toLowerCase().includes(search));
  return send(res, 200, { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize });
}));

router.post('/media', editor, (req, res) => {
  videoUpload.single('video')(req, res, async (error) => {
    if (error || !req.file) return send(res, 400, { error: error?.message || 'Select an MP4, WebM, or Ogg video' });
    try {
      const meta = await probeVideo(req.file.path);
      const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const posterName = `${id}.jpg`;
      fs.mkdirSync(videoPosterDir, { recursive: true });
      await execFileAsync('ffmpeg', ['-y', '-ss', '0', '-i', req.file.path, '-frames:v', '1', '-vf', 'scale=640:-2', path.join(videoPosterDir, posterName)], { maxBuffer: 1024 * 1024 });
      const item = { id, originalName: decodeUploadName(req.file.originalname), mime: req.file.mimetype, size: req.file.size, duration: meta.duration, width: meta.width, height: meta.height, url: `/uploads/cms/videos/${req.file.filename}`, posterUrl: `/uploads/cms/video-posters/${posterName}`, createdAt: nowIso() };
      await withTransaction(async () => {
        const db = await loadDB();
        db.media.unshift(item);
        await persistDB();
      });
      return send(res, 201, item);
    } catch (probeError) {
      await fsp.unlink(req.file.path).catch(() => {});
      return send(res, 400, { error: probeError.message || 'Video validation failed' });
    }
  });
});

router.delete('/media/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const index = db.media.findIndex((item) => item.id === req.params.id);
  if (index < 0) return send(res, 404, { error: 'Media not found' });
  const item = db.media[index];
  const filename = path.basename(new URL(`http://cms${item.url}`).pathname);
  if (isVideoReferenced(db, filename)) return send(res, 409, { error: 'Video is still referenced by a note' });
  db.media.splice(index, 1);
  await persistDB();
  await fsp.unlink(path.join(videoUploadDir, filename)).catch(() => {});
  if (item.posterUrl) await fsp.unlink(path.join(videoPosterDir, path.basename(item.posterUrl))).catch(() => {});
  return send(res, 200, { ok: true });
}));

router.post('/upload', editor, (req, res) => {
  upload.single('image')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return send(res, 400, { code: 'FILE_TOO_LARGE', error: '图片超过 20 MB，无法上传' });
    }
    if (error) return send(res, 400, { error: error.message || 'Upload failed' });
    if (!req.file) return send(res, 400, { error: 'No file selected' });
    return send(res, 201, {
      url: `/uploads/cms/${req.file.filename}`,
      name: req.file.originalname,
    });
  });
});

router.post('/uploads/cleanup', editor, asyncHandler(async (req, res) => {
  return send(res, 200, await cleanupCmsUploads());
}));

export default router;

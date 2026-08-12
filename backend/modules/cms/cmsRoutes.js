import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { attachAuthState } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { loadDB, persistDB, nextId, normalizeTags, uploadDir } from './cmsStore.js';
import { requireEditor, requireViewer } from './cmsAuth.js';
import { cleanupUnreferencedCmsUploads, extractCmsUploadFilenames } from './cmsImages.js';

const router = express.Router();

const send = (res, status, data) => res.status(status).json(data);

// Async middleware/handlers must be wrapped so rejections reach errorHandler
// instead of becoming unhandled rejections (which kill the process in server.js)
const viewer = asyncHandler(requireViewer);
const editor = asyncHandler(requireEditor);

const allowedImages = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)$/i;
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

const normalizeNoteMeta = (note) => ({
  version: noteVersion(note),
  createdAt: note.createdAt || (note.date ? `${note.date}T00:00:00.000Z` : nowIso()),
  updatedAt: note.updatedAt || (note.date ? `${note.date}T00:00:00.000Z` : nowIso()),
});

// 带 private 标签的笔记仅编辑角色可见（大小写不敏感）
const isPrivateNote = (note) => (Array.isArray(note.tags) ? note.tags : [])
  .some(tag => String(tag).trim().toLowerCase() === 'private');

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

router.use(attachAuthState);

router.get('/me', viewer, (req, res) => {
  send(res, 200, { role: req.cmsRole });
});

router.get('/notes', viewer, asyncHandler(async (req, res) => {
  const db = await loadDB();
  let notes = db.notes.map(note => ({ ...note, ...normalizeNoteMeta(note) }));
  if (req.cmsRole !== 'editor') notes = notes.filter(note => !isPrivateNote(note));
  const { category, tag, search, star, notebookId } = req.query;

  if (notebookId) notes = notes.filter(note => note.notebookId === notebookId);
  if (category) notes = notes.filter(note => note.category === category);
  if (tag) notes = notes.filter(note => Array.isArray(note.tags) && note.tags.includes(tag));
  if (star === '1' || star === 'true') notes = notes.filter(note => note.starred);
  if (search) {
    const query = String(search).toLowerCase();
    notes = notes.filter(note =>
      (note.title || '').toLowerCase().includes(query) ||
      (note.excerpt || '').toLowerCase().includes(query) ||
      (note.content || '').toLowerCase().includes(query) ||
      (note.tags || []).some(tagValue => String(tagValue).toLowerCase().includes(query))
    );
  }

  send(res, 200, notes);
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
  const timestamp = nowIso();
  const note = {
    id: nextId(db.notes),
    title: String(body.title),
    category: body.category || 'work',
    notebookId: body.notebookId || null,
    tags: normalizeTags(body.tags),
    date: body.date || new Date().toISOString().split('T')[0],
    readTime: body.readTime || `${Math.max(1, Math.ceil(content.length / 500))} min`,
    excerpt: body.excerpt || markdownExcerpt(content),
    starred: Boolean(body.starred),
    content,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

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
  const previousImages = extractCmsUploadFilenames(current.content);
  const timestamp = nowIso();
  const updated = {
    ...current,
    title: body.title !== undefined ? String(body.title) : current.title,
    category: body.category !== undefined ? body.category : current.category,
    notebookId: body.notebookId !== undefined ? body.notebookId || null : current.notebookId || null,
    tags: body.tags !== undefined ? normalizeTags(body.tags) : current.tags,
    content,
    excerpt: body.excerpt !== undefined ? body.excerpt : (body.content !== undefined ? markdownExcerpt(content) : current.excerpt),
    starred: body.starred !== undefined ? Boolean(body.starred) : current.starred,
    date: body.date !== undefined ? body.date : current.date,
    readTime: body.readTime !== undefined ? body.readTime : current.readTime,
    version: currentVersion + 1,
    createdAt: current.createdAt || timestamp,
    updatedAt: timestamp,
  };

  db.notes[index] = updated;
  await persistDB();
  await cleanupUnreferencedCmsUploads({ notes: db.notes, candidates: previousImages });
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
  await cleanupUnreferencedCmsUploads({ notes: db.notes, candidates: previousImages });
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

  const category = { id, label };
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

  db.categories[index] = { ...db.categories[index], label };
  await persistDB();
  return send(res, 200, db.categories[index]);
}));

router.delete('/categories/:id', editor, asyncHandler(async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  if (db.categories.length <= 1) return send(res, 400, { error: 'At least one category is required' });
  const index = db.categories.findIndex(category => category.id === id);
  if (index === -1) return send(res, 404, { error: 'Category not found' });

  const fallback = db.categories.find(category => category.id !== id)?.id || 'work';
  db.categories = db.categories.filter(category => category.id !== id);
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
  const db = await loadDB();
  const removed = await cleanupUnreferencedCmsUploads({
    notes: db.notes,
    minAgeMs: 24 * 60 * 60 * 1000,
  });
  return send(res, 200, { removed, count: removed.length });
}));

export default router;

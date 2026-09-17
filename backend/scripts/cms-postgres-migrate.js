#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { closeCmsPool, runCmsMigrations } from '../modules/cms/cmsPostgresDb.js';
import { importPostgresDB, loadPostgresDB } from '../modules/cms/cmsPostgresStore.js';
import Password from '../models/Password.js';
import { syncCmsOwnerCredential } from '../modules/cms/cmsAccount.js';
import { securitySequelize } from '../config/databases.js';
import { sha256File, syncCmsAttachments } from '../modules/cms/cmsAttachments.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] || 'help';
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const sha = (value) => createHash('sha256').update(value).digest('hex');

const sourceDefault = path.resolve(backendRoot, config.cms.dataDir, config.cms.dbFile);
const uploadPattern = /\/uploads\/cms\/([^\s)"'?#]+)/g;
const mimeFor = (name) => ({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
}[path.extname(name).toLowerCase()] || 'application/octet-stream');

const auditAttachments = async (database, uploadRoot) => {
  if (!uploadRoot) return { items: [], missing: [], warning: 'Attachment validation skipped; pass --upload-dir' };
  const references = new Set();
  const documents = [...database.notes, ...database.whiteboards, ...database.menus,
    ...database.whiteboards.flatMap((board) => board.archives || [])];
  for (const document of documents) {
    const source = String(document?.content || '');
    let match;
    while ((match = uploadPattern.exec(source))) references.add(match[1]);
  }
  for (const media of database.media) {
    for (const url of [media.url, media.posterUrl]) {
      if (String(url || '').startsWith('/uploads/cms/')) references.add(String(url).slice('/uploads/cms/'.length));
    }
  }
  const items = [];
  const missing = [];
  const root = path.resolve(uploadRoot);
  for (const encoded of [...references].sort()) {
    let relative;
    try { relative = decodeURIComponent(encoded); } catch { relative = encoded; }
    relative = relative.split('/').filter(Boolean).join(path.sep);
    const file = path.resolve(root, relative);
    const publicPath = `/uploads/cms/${encoded.split(path.sep).join('/')}`;
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) { missing.push(encoded); continue; }
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      const media = database.media.find((item) => item.url === publicPath || item.posterUrl === publicPath);
      const item = {
        path: publicPath, originalName: media?.url === publicPath ? media.originalName : path.basename(relative),
        mime: media?.url === publicPath ? media.mime : mimeFor(relative), size: stat.size, sha256: await sha256File(file),
      };
      items.push(item);
      if (media?.url === publicPath) media.sha256 = item.sha256;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(publicPath);
    }
  }
  return { items, missing, warning: null };
};

const normalize = (database) => {
  const result = structuredClone(database);
  result.notes = Array.isArray(result.notes) ? result.notes : [];
  result.categories = Array.isArray(result.categories) ? result.categories : [];
  result.menus = Array.isArray(result.menus) ? result.menus : [];
  result.media = Array.isArray(result.media) ? result.media : [];
  result.diaryConversions = result.diaryConversions && typeof result.diaryConversions === 'object' ? result.diaryConversions : {};
  result.categories = result.categories.map((category) => ({
    ...category,
    parentId: category.parentId || null,
    notebookId: Array.isArray(category.notebookId) ? category.notebookId : category.notebookId ? [category.notebookId] : [],
  }));
  const boards = Array.isArray(result.whiteboards) ? result.whiteboards : [];
  if (boards.some((board) => board.id === 'dp') && boards.some((board) => board.id === 'dailyPush')) {
    throw new Error('Both dp and dailyPush whiteboards exist');
  }
  result.whiteboards = boards.map((board) => ({ ...board, id: board.id === 'dailyPush' ? 'dp' : board.id }));
  for (const id of ['t', 'b', 'w', 'dp', 'n']) {
    if (!result.whiteboards.some((board) => board.id === id)) {
      result.whiteboards.push({ id, content: '', version: 1, updatedAt: null, archives: [] });
    }
  }
  return result;
};

const validate = (database) => {
  const errors = [];
  const warnings = [];
  const unique = (items, field, label) => {
    const seen = new Set();
    for (const item of items) {
      const key = String(item?.[field] ?? '');
      if (!key) errors.push(`${label} has an empty ${field}`);
      else if (seen.has(key)) errors.push(`${label} has duplicate ${field}: ${key}`);
      seen.add(key);
    }
    return seen;
  };
  const noteIds = unique(database.notes, 'id', 'notes');
  const categoryIds = unique(database.categories, 'id', 'categories');
  const menuIds = unique(database.menus, 'id', 'menus');
  unique(database.whiteboards, 'id', 'whiteboards');
  unique(database.media, 'id', 'media');
  const notebookIds = new Set(database.menus.filter((item) => item.type === 'notebook').map((item) => String(item.id)));
  for (const category of database.categories) {
    if (category.parentId && !categoryIds.has(String(category.parentId))) errors.push(`category ${category.id} has missing parent ${category.parentId}`);
    for (const notebookId of category.notebookId || []) if (!menuIds.has(String(notebookId))) errors.push(`category ${category.id} has missing notebook ${notebookId}`);
    const seen = new Set([String(category.id)]);
    let parent = category.parentId;
    while (parent) {
      if (seen.has(String(parent))) { errors.push(`category cycle detected at ${category.id}`); break; }
      seen.add(String(parent));
      parent = database.categories.find((item) => String(item.id) === String(parent))?.parentId;
    }
  }
  for (const note of database.notes) {
    if (!Number.isSafeInteger(Number(note.id)) || Number(note.id) < 1) errors.push(`note has invalid numeric id: ${note.id}`);
    if (note.category && !categoryIds.has(String(note.category))) errors.push(`note ${note.id} has missing category ${note.category}`);
    if (note.notebookId && !notebookIds.has(String(note.notebookId))) errors.push(`note ${note.id} has missing notebook ${note.notebookId}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      notes: noteIds.size,
      categories: categoryIds.size,
      menus: menuIds.size,
      whiteboards: database.whiteboards.length,
      media: database.media.length,
    },
  };
};

const canonicalDataset = (database) => ({
  notes: database.notes.map((note) => ({
    id: Number(note.id), title: String(note.title || ''), content: String(note.content || ''),
    category: note.category || null, notebookId: note.notebookId || null,
    tags: [...new Set(note.tags || [])].sort(), date: note.date ? String(note.date).slice(0, 10) : null,
    readTime: note.readTime || null, excerpt: note.excerpt || '', desc: note.desc || '',
    starred: Boolean(note.starred), pinned: Boolean(note.pinned), version: Number(note.version || 1),
  })).sort((a, b) => a.id - b.id),
  categories: database.categories.map((item) => ({ id: String(item.id), label: String(item.label || ''), parentId: item.parentId || null, notebookId: [...(item.notebookId || [])].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
  menus: database.menus.map((item) => ({ id: String(item.id), label: String(item.label || ''), type: item.type || 'notebook', contentKey: item.contentKey || null, content: item.content || null })).sort((a, b) => a.id.localeCompare(b.id)),
  whiteboards: database.whiteboards.map((board) => ({ id: board.id === 'dailyPush' ? 'dp' : board.id, content: board.content || '', archives: board.archives || [], version: Number(board.version || 1) })).sort((a, b) => a.id.localeCompare(b.id)),
  media: database.media.map((item) => ({ id: String(item.id), originalName: item.originalName || '', mime: item.mime || null, size: Number(item.size || 0), duration: item.duration || null, width: item.width || null, height: item.height || null, url: item.url, posterUrl: item.posterUrl || null, sha256: item.sha256 || null })).sort((a, b) => a.id.localeCompare(b.id)),
});
const contentDigest = (database) => sha(JSON.stringify(canonicalDataset(database)));

const main = async () => {
  if (!['import', 'export', 'verify'].includes(command)) {
    console.log('Usage: cms-postgres-migrate.js import --source db.json [--apply] [--replace]\n' +
      '       cms-postgres-migrate.js export --output db.json\n' +
      '       cms-postgres-migrate.js verify --source db.json');
    return;
  }
  if (command === 'import' || command === 'verify') {
    const source = path.resolve(value('source', sourceDefault));
    const raw = await fs.readFile(source, 'utf8');
    const database = normalize(JSON.parse(raw));
    const report = validate(database);
    const attachmentReport = await auditAttachments(database, value('upload-dir'));
    if (attachmentReport.warning) report.warnings.push(attachmentReport.warning);
    if (attachmentReport.missing.length) report.errors.push(...attachmentReport.missing.map((item) => `missing attachment: ${item}`));
    report.ok = report.errors.length === 0;
    report.counts.attachments = attachmentReport.items.length;
    console.log(JSON.stringify({ source, ...report, contentDigest: contentDigest(database), dryRun: !flag('apply') }, null, 2));
    if (!report.ok) throw new Error('Migration validation failed');
    if (command === 'verify' || !flag('apply')) return;
    if (!value('upload-dir')) throw new Error('--upload-dir is required with --apply');
    await runCmsMigrations();
    const imported = await importPostgresDB(database, { replace: flag('replace') });
    await syncCmsAttachments(attachmentReport.items, { replace: true });
    const credential = await Password.findOne({ where: { type: 'default' } }).catch(() => null);
    if (credential) await syncCmsOwnerCredential(credential, { force: true });
    const importedReport = validate(imported);
    importedReport.counts.attachments = attachmentReport.items.length;
    if (!importedReport.ok || contentDigest(imported) !== contentDigest(database)) throw new Error('PostgreSQL verification failed after import');
    console.log(JSON.stringify({ applied: true, counts: importedReport.counts, contentDigest: contentDigest(imported) }, null, 2));
    return;
  }
  await runCmsMigrations();
  const database = await loadPostgresDB();
  const report = validate(database);
  if (!report.ok) throw new Error(`Refusing to export invalid PostgreSQL data: ${report.errors.join('; ')}`);
  const output = value('output');
  if (!output) throw new Error('--output is required');
  const target = path.resolve(output);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ exported: target, ...report, contentDigest: contentDigest(database) }, null, 2));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(async () => {
    await closeCmsPool();
    await securitySequelize.close().catch(() => {});
  });
}

export { normalize, validate, auditAttachments, canonicalDataset, contentDigest };

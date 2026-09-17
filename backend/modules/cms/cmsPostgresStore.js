import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../../config/index.js';
import { ensureCmsOwner, getCmsPool } from './cmsPostgresDb.js';

const context = new AsyncLocalStorage();
const ownerId = () => config.cms.ownerId;
const iso = (value) => value ? new Date(value).toISOString() : null;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const stable = (value) => JSON.stringify(canonical(value));
const changed = (before, after) => stable(before) !== stable(after);
const archived = (tags) => (tags || []).some((tag) => String(tag).trim().toLowerCase() === 'archived');
const userTags = (tags) => [...new Set((tags || []).map((tag) => String(tag).trim()).filter((tag) => tag && tag.toLowerCase() !== 'archived'))];
const hashPayload = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const query = (client, sql, params = []) => client.query(sql, params);

const loadPostgresDBFrom = async (client) => {
  const owner = ownerId();
  const menusResult = await query(client, `SELECT id, legacy_key, label, kind, content_key, content, version, created_at, updated_at
      FROM cms_navigation_items WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order, created_at`, [owner]);
  const categoriesResult = await query(client, `SELECT c.id, c.legacy_key, c.label, p.legacy_key parent_key, c.version, c.created_at, c.updated_at,
      COALESCE(array_agg(n.legacy_key ORDER BY n.sort_order) FILTER (WHERE n.id IS NOT NULL), '{}') notebook_keys
      FROM cms_categories c
      LEFT JOIN cms_categories p ON p.id=c.parent_id
      LEFT JOIN cms_category_notebooks cn ON cn.category_id=c.id
      LEFT JOIN cms_navigation_items n ON n.id=cn.notebook_id AND n.deleted_at IS NULL
      WHERE c.owner_id=$1 AND c.deleted_at IS NULL
      GROUP BY c.id, p.legacy_key ORDER BY c.sort_order, c.created_at`, [owner]);
  const notesResult = await query(client, `SELECT n.*, to_char(n.note_date, 'YYYY-MM-DD') note_date, nav.legacy_key notebook_key, c.legacy_key category_key,
      COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL AND t.deleted_at IS NULL), '{}') tags
      FROM cms_notes n
      LEFT JOIN cms_navigation_items nav ON nav.id=n.notebook_id
      LEFT JOIN cms_categories c ON c.id=n.category_id
      LEFT JOIN cms_note_tags nt ON nt.note_id=n.id
      LEFT JOIN cms_tags t ON t.id=nt.tag_id
      WHERE n.owner_id=$1 AND n.deleted_at IS NULL
      GROUP BY n.id, nav.legacy_key, c.legacy_key
      ORDER BY n.pinned DESC, n.updated_at DESC`, [owner]);
  const whiteboardsResult = await query(client, 'SELECT * FROM cms_whiteboards WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at', [owner]);
  const mediaResult = await query(client, 'SELECT * FROM cms_media_assets WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [owner]);
  const conversionsResult = await query(client, `SELECT mutation_id, payload_hash, response FROM cms_idempotency_records
      WHERE owner_id=$1 AND scope='diary-conversion'`, [owner]);

  const menus = menusResult.rows.map((row) => ({
    id: row.legacy_key, label: row.label, type: row.kind,
    contentKey: row.content_key, content: row.content,
  }));
  const categories = categoriesResult.rows.map((row) => ({
    id: row.legacy_key, label: row.label, parentId: row.parent_key || null,
    notebookId: row.notebook_keys || [],
  }));
  const notes = notesResult.rows.map((row) => ({
    id: Number(row.legacy_id), title: row.title, category: row.category_key || null,
    notebookId: row.notebook_key || null,
    tags: row.archived_at ? [...row.tags, 'archived'] : row.tags,
    date: row.note_date instanceof Date ? row.note_date.toISOString().slice(0, 10) : row.note_date || null, readTime: row.read_time, excerpt: row.excerpt,
    desc: row.description, starred: row.starred, pinned: row.pinned,
    content: row.content, version: Number(row.version),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }));
  const whiteboards = whiteboardsResult.rows.map((row) => ({
    id: row.legacy_key, content: row.content, archives: row.archives || [],
    version: Number(row.version), updatedAt: iso(row.updated_at),
  }));
  const media = mediaResult.rows.map((row) => ({
    id: row.legacy_key, originalName: row.original_name, mime: row.mime,
    size: Number(row.size_bytes || 0), duration: row.duration, width: row.width, height: row.height,
    url: row.url, posterUrl: row.poster_url, sha256: row.sha256, createdAt: iso(row.created_at),
  }));
  const diaryConversions = Object.fromEntries(conversionsResult.rows.map((row) => [row.mutation_id, {
    fingerprint: row.payload_hash, result: row.response,
  }]));
  const first = whiteboards.find((board) => board.id === 't') || { content: '', version: 1, updatedAt: null };
  return {
    notes, categories, menus, whiteboards, media, diaryConversions,
    whiteboard: { content: first.content, version: first.version, updatedAt: first.updatedAt },
  };
};

const loadPostgresDB = async () => {
  const state = context.getStore();
  if (state?.draft) return state.draft;
  return loadPostgresDBFrom(state?.client || getCmsPool());
};

const loadExisting = async (client, table, keyColumn) => {
  const result = await query(client, `SELECT * FROM ${table} WHERE owner_id=$1`, [ownerId()]);
  return new Map(result.rows.map((row) => [String(row[keyColumn]), row]));
};

const logChange = async (client, entityType, entityId, operation, version, data) => {
  await query(client, `INSERT INTO cms_change_log(owner_id, entity_type, entity_id, operation, version, data)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [ownerId(), entityType, entityId, operation, version, data === null ? null : JSON.stringify(data)]);
};

const softDeleteMissing = async (client, table, entityType, existing, liveKeys, keyColumn) => {
  for (const [key, row] of existing) {
    if (liveKeys.has(key) || row.deleted_at) continue;
    const nextVersion = Number(row.version || 1) + 1;
    await query(client, `UPDATE ${table} SET deleted_at=now(), updated_at=now(), version=$2 WHERE id=$1`, [row.id, nextVersion]);
    await logChange(client, entityType, row.id, 'delete', nextVersion, null);
  }
};

const persistAggregate = async (client, next, previous = {}) => {
  await ensureCmsOwner(client);
  const now = new Date().toISOString();

  const existingMenus = await loadExisting(client, 'cms_navigation_items', 'legacy_key');
  const menuIds = new Map();
  for (const [index, item] of (next.menus || []).entries()) {
    const old = existingMenus.get(String(item.id));
    const id = old?.id || uuidv7();
    const comparable = { label: item.label, type: item.type || 'notebook', contentKey: item.contentKey || null, content: item.content || null };
    const prior = old && { label: old.label, type: old.kind, contentKey: old.content_key, content: old.content };
    const version = old ? Number(old.version) + (changed(prior, comparable) || old.deleted_at ? 1 : 0) : 1;
    await query(client, `INSERT INTO cms_navigation_items(id,owner_id,legacy_key,label,kind,content_key,content,sort_order,version,created_at,updated_at,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,now()),$11::timestamptz,NULL)
      ON CONFLICT(owner_id,legacy_key) DO UPDATE SET label=EXCLUDED.label,kind=EXCLUDED.kind,content_key=EXCLUDED.content_key,
      content=EXCLUDED.content,sort_order=EXCLUDED.sort_order,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
    [id, ownerId(), item.id, item.label, item.type || 'notebook', item.contentKey || null, item.content || null, index, version, old?.created_at || now, now]);
    menuIds.set(String(item.id), id);
    if (!old || version !== Number(old.version)) await logChange(client, 'navigationItem', id, 'upsert', version, { id, legacyId: item.id, ...comparable, version });
  }
  await softDeleteMissing(client, 'cms_navigation_items', 'navigationItem', existingMenus, new Set(menuIds.keys()), 'legacy_key');

  const existingCategories = await loadExisting(client, 'cms_categories', 'legacy_key');
  const categoryIds = new Map();
  const categoryChanges = [];
  for (const [index, item] of (next.categories || []).entries()) {
    const old = existingCategories.get(String(item.id));
    const id = old?.id || uuidv7();
    const previousItem = (previous.categories || []).find((entry) => String(entry.id) === String(item.id));
    const version = old ? Number(old.version) + (changed(previousItem, item) || old.deleted_at ? 1 : 0) : 1;
    await query(client, `INSERT INTO cms_categories(id,owner_id,legacy_key,label,sort_order,version,created_at,updated_at,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()),$8::timestamptz,NULL)
      ON CONFLICT(owner_id,legacy_key) DO UPDATE SET label=EXCLUDED.label,sort_order=EXCLUDED.sort_order,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
    [id, ownerId(), item.id, item.label, index, version, old?.created_at || now, now]);
    categoryIds.set(String(item.id), id);
    if (!old || version !== Number(old.version)) categoryChanges.push({ item, id, version });
  }
  for (const item of (next.categories || [])) {
    await query(client, 'UPDATE cms_categories SET parent_id=$2 WHERE id=$1', [categoryIds.get(String(item.id)), item.parentId ? categoryIds.get(String(item.parentId)) || null : null]);
    await query(client, 'DELETE FROM cms_category_notebooks WHERE category_id=$1', [categoryIds.get(String(item.id))]);
    for (const notebook of (Array.isArray(item.notebookId) ? item.notebookId : item.notebookId ? [item.notebookId] : [])) {
      const notebookUuid = menuIds.get(String(notebook));
      if (notebookUuid) await query(client, 'INSERT INTO cms_category_notebooks(category_id,notebook_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [categoryIds.get(String(item.id)), notebookUuid]);
    }
  }
  for (const { item, id, version } of categoryChanges) {
    await logChange(client, 'category', id, 'upsert', version, {
      id, legacyId: item.id, label: item.label,
      parentId: item.parentId ? categoryIds.get(String(item.parentId)) || null : null,
      notebookIds: (item.notebookId || []).map((key) => menuIds.get(String(key))).filter(Boolean),
      version,
    });
  }
  await softDeleteMissing(client, 'cms_categories', 'category', existingCategories, new Set(categoryIds.keys()), 'legacy_key');

  const existingNotes = await loadExisting(client, 'cms_notes', 'legacy_id');
  const liveNotes = new Set();
  for (const item of (next.notes || [])) {
    const legacyId = String(item.id);
    liveNotes.add(legacyId);
    const old = existingNotes.get(legacyId);
    const id = old?.id || uuidv7();
    const version = Math.max(Number(item.version || 1), old ? Number(old.version) : 1);
    const isArchived = archived(item.tags);
    await query(client, `INSERT INTO cms_notes(id,owner_id,legacy_id,notebook_id,category_id,title,content,description,excerpt,note_date,read_time,starred,pinned,archived_at,version,created_at,updated_at,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,$16::timestamptz,$17::timestamptz,NULL)
      ON CONFLICT(owner_id,legacy_id) DO UPDATE SET notebook_id=EXCLUDED.notebook_id,category_id=EXCLUDED.category_id,title=EXCLUDED.title,
      content=EXCLUDED.content,description=EXCLUDED.description,excerpt=EXCLUDED.excerpt,note_date=EXCLUDED.note_date,read_time=EXCLUDED.read_time,
      starred=EXCLUDED.starred,pinned=EXCLUDED.pinned,archived_at=EXCLUDED.archived_at,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
    [id, ownerId(), item.id, menuIds.get(String(item.notebookId)) || null, categoryIds.get(String(item.category)) || null,
      item.title || '', item.content || '', item.desc || '', item.excerpt || '', item.date || null, item.readTime || null,
      Boolean(item.starred), Boolean(item.pinned), isArchived ? (item.updatedAt || now) : null, version,
      item.createdAt || now, item.updatedAt || now]);
    await query(client, 'DELETE FROM cms_note_tags WHERE note_id=$1', [id]);
    for (const tagName of userTags(item.tags)) {
      const normalized = tagName.toLocaleLowerCase();
      const tagResult = await query(client, `INSERT INTO cms_tags(id,owner_id,name,normalized_name)
        VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,deleted_at=NULL,updated_at=now()
        RETURNING id`, [uuidv7(), ownerId(), tagName, normalized]);
      await query(client, 'INSERT INTO cms_note_tags(note_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, tagResult.rows[0].id]);
    }
    const previousItem = (previous.notes || []).find((entry) => String(entry.id) === legacyId);
    if (!old || changed(previousItem, item) || old.deleted_at) {
      const { category: _legacyCategory, notebookId: _legacyNotebook, ...noteData } = item;
      await logChange(client, 'note', id, 'upsert', version, {
        ...noteData, id, legacyId: Number(item.id),
        notebookId: menuIds.get(String(item.notebookId)) || null,
        categoryId: categoryIds.get(String(item.category)) || null,
        archivedAt: isArchived ? (item.updatedAt || now) : null,
        tags: userTags(item.tags), version,
      });
    }
  }
  await softDeleteMissing(client, 'cms_notes', 'note', existingNotes, liveNotes, 'legacy_id');
  await query(client, `SELECT setval('cms_note_legacy_id_seq',
    GREATEST((SELECT COALESCE(max(legacy_id), 0) FROM cms_notes), 1),
    (SELECT count(*) > 0 FROM cms_notes))`);

  const existingBoards = await loadExisting(client, 'cms_whiteboards', 'legacy_key');
  const liveBoards = new Set();
  for (const item of (next.whiteboards || [])) {
    liveBoards.add(String(item.id));
    const old = existingBoards.get(String(item.id));
    const id = old?.id || uuidv7();
    const version = Math.max(Number(item.version || 1), old ? Number(old.version) : 1);
    await query(client, `INSERT INTO cms_whiteboards(id,owner_id,legacy_key,content,archives,version,created_at,updated_at,deleted_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,COALESCE($7::timestamptz,now()),$8::timestamptz,NULL)
      ON CONFLICT(owner_id,legacy_key) DO UPDATE SET content=EXCLUDED.content,archives=EXCLUDED.archives,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
    [id, ownerId(), item.id, item.content || '', JSON.stringify(item.archives || []), version, old?.created_at || now, item.updatedAt || now]);
    const previousItem = (previous.whiteboards || []).find((entry) => String(entry.id) === String(item.id));
    if (!old || changed(previousItem, item) || old.deleted_at) await logChange(client, 'whiteboard', id, 'upsert', version, { ...item, id, legacyId: item.id, version });
  }
  await softDeleteMissing(client, 'cms_whiteboards', 'whiteboard', existingBoards, liveBoards, 'legacy_key');

  const existingMedia = await loadExisting(client, 'cms_media_assets', 'legacy_key');
  const liveMedia = new Set();
  for (const item of (next.media || [])) {
    liveMedia.add(String(item.id));
    const old = existingMedia.get(String(item.id));
    const id = old?.id || uuidv7();
    const previousItem = (previous.media || []).find((entry) => String(entry.id) === String(item.id));
    const version = old ? Number(old.version) + (changed(previousItem, item) || old.deleted_at ? 1 : 0) : 1;
    await query(client, `INSERT INTO cms_media_assets(id,owner_id,legacy_key,original_name,mime,size_bytes,duration,width,height,url,poster_url,sha256,version,created_at,updated_at,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz,now()),$15::timestamptz,NULL)
      ON CONFLICT(owner_id,legacy_key) DO UPDATE SET original_name=EXCLUDED.original_name,mime=EXCLUDED.mime,size_bytes=EXCLUDED.size_bytes,
      duration=EXCLUDED.duration,width=EXCLUDED.width,height=EXCLUDED.height,url=EXCLUDED.url,poster_url=EXCLUDED.poster_url,sha256=EXCLUDED.sha256,
      version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
    [id, ownerId(), item.id, item.originalName || '', item.mime || null, item.size || null, item.duration || null, item.width || null,
      item.height || null, item.url, item.posterUrl || null, item.sha256 || null, version, item.createdAt || now, now]);
    if (!old || version !== Number(old.version)) await logChange(client, 'media', id, 'upsert', version, { ...item, id, legacyId: item.id, version });
  }
  await softDeleteMissing(client, 'cms_media_assets', 'media', existingMedia, liveMedia, 'legacy_key');

  for (const [mutationId, record] of Object.entries(next.diaryConversions || {})) {
    await query(client, `INSERT INTO cms_idempotency_records(owner_id,scope,mutation_id,payload_hash,status_code,response)
      VALUES($1,'diary-conversion',$2,$3,201,$4::jsonb) ON CONFLICT(owner_id,scope,mutation_id) DO NOTHING`,
    [ownerId(), mutationId, record.fingerprint || hashPayload(record.result), JSON.stringify(record.result || {})]);
  }
};

const persistPostgresDB = async () => {
  const state = context.getStore();
  if (state?.client) {
    await persistAggregate(state.client, state.draft, state.original);
    state.persisted = true;
    return;
  }
  return withPostgresTransaction(async () => {
    const nested = context.getStore();
    await persistAggregate(nested.client, nested.draft, nested.original);
    nested.persisted = true;
  });
};

const withPostgresTransaction = async (operation) => {
  if (context.getStore()) return operation();
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [87421032]);
    const original = await loadPostgresDBFrom(client);
    const state = { client, original, draft: structuredClone(original), persisted: false };
    const result = await context.run(state, operation);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const importPostgresDB = async (database, { replace = false } = {}) => withPostgresTransaction(async () => {
  const state = context.getStore();
  if (!replace && (state.original.notes.length || state.original.categories.length || state.original.menus.length)) {
    throw new Error('PostgreSQL CMS already contains data; pass replace=true to replace it');
  }
  if (replace) {
    await state.client.query(`TRUNCATE cms_change_log,cms_idempotency_records,cms_note_tags,cms_tags,cms_notes,
      cms_category_notebooks,cms_categories,cms_navigation_items,cms_whiteboards,cms_media_assets RESTART IDENTITY CASCADE`);
    state.original = { notes: [], categories: [], menus: [], whiteboards: [], media: [], diaryConversions: {} };
  }
  state.draft = structuredClone(database);
  await persistAggregate(state.client, state.draft, {});
  state.persisted = true;
  return loadPostgresDBFrom(state.client);
});

export { loadPostgresDB, persistPostgresDB, withPostgresTransaction, importPostgresDB, hashPayload };

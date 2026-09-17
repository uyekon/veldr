import express from 'express';
import { createHash } from 'node:crypto';
import { validate as isUuid, v7 as uuidv7 } from 'uuid';
import { config } from '../../config/index.js';
import { attachAuthState } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { requireEditor } from './cmsAuth.js';
import { getCmsPool } from './cmsPostgresDb.js';

const router = express.Router();
const ownerId = () => config.cms.ownerId;
const mutationPattern = /^[a-zA-Z0-9_-]{16,100}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const jsonHash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uniqueTags = (values) => {
  const tags = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const name = String(value).trim();
    if (name && !tags.has(name.toLocaleLowerCase())) tags.set(name.toLocaleLowerCase(), name);
  }
  return [...tags.values()];
};

router.use(attachAuthState, asyncHandler(requireEditor));
router.use((_req, res, next) => config.cms.store === 'postgres'
  ? next()
  : res.status(503).json({ error: 'CMS v1 requires CMS_STORE=postgres', code: 'STORE_NOT_READY' }));
router.param('id', (req, res, next, id) => isUuid(id)
  ? next()
  : res.status(400).json({ error: 'id must be a UUID', code: 'INVALID_ID' }));

const inTransaction = async (operation) => {
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const noteSelect = `SELECT n.*, to_char(n.note_date, 'YYYY-MM-DD') note_date, nav.id notebook_uuid, c.id category_uuid,
  COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL AND t.deleted_at IS NULL), '{}') tags
  FROM cms_notes n
  LEFT JOIN cms_navigation_items nav ON nav.id=n.notebook_id
  LEFT JOIN cms_categories c ON c.id=n.category_id
  LEFT JOIN cms_note_tags nt ON nt.note_id=n.id
  LEFT JOIN cms_tags t ON t.id=nt.tag_id`;

const noteFromRow = (row) => ({
  id: row.id,
  legacyId: Number(row.legacy_id),
  title: row.title,
  content: row.content,
  description: row.description,
  excerpt: row.excerpt,
  date: row.note_date,
  readTime: row.read_time,
  notebookId: row.notebook_uuid || null,
  categoryId: row.category_uuid || null,
  tags: row.tags || [],
  starred: row.starred,
  pinned: row.pinned,
  archivedAt: row.archived_at,
  version: Number(row.version),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getNote = async (client, id, { includeDeleted = false } = {}) => {
  const result = await client.query(`${noteSelect}
    WHERE n.owner_id=$1 AND n.id=$2 ${includeDeleted ? '' : 'AND n.deleted_at IS NULL'}
    GROUP BY n.id, nav.id, c.id`, [ownerId(), id]);
  return result.rows[0] ? noteFromRow(result.rows[0]) : null;
};

const addChange = (client, type, id, operation, version, data) => client.query(`
  INSERT INTO cms_change_log(owner_id,entity_type,entity_id,operation,version,data)
  VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [ownerId(), type, id, operation, version, data ? JSON.stringify(data) : null]);
const categoryAcceptsNotebook = async (client, categoryId, notebookId) => {
  if (!categoryId) return true;
  const result = await client.query(`SELECT count(*)::int total,
    count(*) FILTER (WHERE notebook_id=$2::uuid)::int matching
    FROM cms_category_notebooks WHERE category_id=$1`, [categoryId, notebookId || null]);
  return result.rows[0].total === 0 || result.rows[0].matching > 0;
};

const requireMutation = (req, res) => {
  const mutationId = String(req.body?.mutationId || '');
  if (!mutationPattern.test(mutationId)) {
    res.status(400).json({ error: 'mutationId must be 16-100 letters, digits, underscores, or hyphens', code: 'INVALID_MUTATION_ID' });
    return null;
  }
  return mutationId;
};

const runIdempotent = async ({ client, scope, mutationId, payload, operation }) => {
  const digest = jsonHash(payload);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${ownerId()}:${scope}:${mutationId}`]);
  const existing = await client.query(`SELECT payload_hash,status_code,response FROM cms_idempotency_records
    WHERE owner_id=$1 AND scope=$2 AND mutation_id=$3 FOR UPDATE`, [ownerId(), scope, mutationId]);
  if (existing.rows[0]) {
    if (existing.rows[0].payload_hash !== digest) return { status: 409, body: { error: 'mutationId was already used with another payload', code: 'MUTATION_CONFLICT' } };
    return { status: existing.rows[0].status_code, body: { ...existing.rows[0].response, replayed: true } };
  }
  const result = await operation();
  await client.query(`INSERT INTO cms_idempotency_records(owner_id,scope,mutation_id,payload_hash,status_code,response)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [ownerId(), scope, mutationId, digest, result.status, JSON.stringify(result.body)]);
  return result;
};

router.get('/sync/bootstrap', asyncHandler(async (_req, res) => {
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const cursorResult = await client.query('SELECT COALESCE(max(sequence),0)::text cursor FROM cms_change_log WHERE owner_id=$1', [ownerId()]);
    const notes = await client.query(`${noteSelect} WHERE n.owner_id=$1 AND n.deleted_at IS NULL GROUP BY n.id,nav.id,c.id ORDER BY n.updated_at`, [ownerId()]);
    const notebooks = await client.query(`SELECT id,legacy_key "legacyId",label,kind "type",content_key "contentKey",content,version,created_at "createdAt",updated_at "updatedAt"
        FROM cms_navigation_items WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order`, [ownerId()]);
    const categories = await client.query(`SELECT c.id,c.legacy_key "legacyId",c.label,c.parent_id "parentId",c.version,c.created_at "createdAt",c.updated_at "updatedAt",
        COALESCE(array_agg(ni.id) FILTER (WHERE ni.id IS NOT NULL),'{}') "notebookIds"
        FROM cms_categories c LEFT JOIN cms_category_notebooks cn ON cn.category_id=c.id
        LEFT JOIN cms_navigation_items ni ON ni.id=cn.notebook_id AND ni.deleted_at IS NULL
        WHERE c.owner_id=$1 AND c.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order`, [ownerId()]);
    const whiteboards = await client.query(`SELECT id,legacy_key "legacyId",content,archives,version,created_at "createdAt",updated_at "updatedAt"
        FROM cms_whiteboards WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [ownerId()]);
    const media = await client.query(`SELECT id,legacy_key "legacyId",original_name "originalName",mime,size_bytes "size",duration,width,height,url,poster_url "posterUrl",sha256,version,created_at "createdAt",updated_at "updatedAt"
        FROM cms_media_assets WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [ownerId()]);
    const attachments = await client.query(`SELECT id,path,original_name "originalName",mime,size_bytes "size",sha256,version,created_at "createdAt",updated_at "updatedAt"
        FROM cms_attachments WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [ownerId()]);
    await client.query('COMMIT');
    res.json({
      cursor: cursorResult.rows[0].cursor,
      entities: { notes: notes.rows.map(noteFromRow), notebooks: notebooks.rows, categories: categories.rows, whiteboards: whiteboards.rows, media: media.rows, attachments: attachments.rows },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/sync/changes', asyncHandler(async (req, res) => {
  const cursor = /^\d+$/.test(String(req.query.cursor || '0')) ? String(req.query.cursor || '0') : null;
  if (cursor === null) return res.status(400).json({ error: 'cursor must be a non-negative integer', code: 'INVALID_CURSOR' });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const result = await getCmsPool().query(`SELECT sequence::text,entity_type "entityType",entity_id "entityId",operation,version,changed_at "changedAt",data
    FROM cms_change_log WHERE owner_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`, [ownerId(), cursor, limit + 1]);
  const hasMore = result.rows.length > limit;
  const changes = result.rows.slice(0, limit);
  res.json({ changes, nextCursor: changes.at(-1)?.sequence || cursor, hasMore });
}));

router.get('/notebooks', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`SELECT id,legacy_key "legacyId",label,kind "type",content_key "contentKey",content,version,created_at "createdAt",updated_at "updatedAt"
    FROM cms_navigation_items WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY sort_order`, [ownerId()]);
  res.json({ items: result.rows });
}));

router.post('/notebooks', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res);
  if (!mutationId) return;
  const payload = { ...req.body }; delete payload.mutationId;
  if (!String(payload.label || '').trim()) return res.status(400).json({ error: 'label is required' });
  const result = await inTransaction(async (client) => runIdempotent({
    client, scope: 'v1:create-notebook', mutationId, payload,
    operation: async () => {
      const id = uuidv7();
      const legacyId = `notebook_${Date.now()}_${id.slice(-6)}`;
      const type = ['notebook', 'page'].includes(payload.type) ? payload.type : 'notebook';
      const inserted = await client.query(`INSERT INTO cms_navigation_items(id,owner_id,legacy_key,label,kind,content_key,content,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),-1)+1 FROM cms_navigation_items WHERE owner_id=$2))
        RETURNING id,legacy_key "legacyId",label,kind "type",content_key "contentKey",content,version,created_at "createdAt",updated_at "updatedAt"`,
      [id, ownerId(), legacyId, String(payload.label).trim(), type, payload.contentKey || null, payload.content || null]);
      await addChange(client, 'navigationItem', id, 'upsert', 1, inserted.rows[0]);
      return { status: 201, body: inserted.rows[0] };
    },
  }));
  res.status(result.status).json(result.body);
}));

router.put('/notebooks/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res);
  if (!mutationId) return;
  const payload = { ...req.body }; delete payload.mutationId;
  if (!Number.isInteger(payload.baseVersion)) return res.status(400).json({ error: 'baseVersion is required' });
  if (Object.hasOwn(payload, 'label') && !String(payload.label || '').trim()) return res.status(400).json({ error: 'label cannot be empty' });
  const result = await inTransaction(async (client) => runIdempotent({
    client, scope: `v1:update-notebook:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await client.query('SELECT * FROM cms_navigation_items WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [ownerId(), req.params.id]);
      if (!current.rowCount) return { status: 404, body: { error: 'Notebook not found' } };
      if (Number(current.rows[0].version) !== payload.baseVersion) return { status: 409, body: { error: 'Notebook version conflict', code: 'VERSION_CONFLICT', current: current.rows[0] } };
      const updated = await client.query(`UPDATE cms_navigation_items SET label=COALESCE($3,label),content_key=CASE WHEN $4 THEN $5 ELSE content_key END,
        content=CASE WHEN $6 THEN $7 ELSE content END,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2
        RETURNING id,legacy_key "legacyId",label,kind "type",content_key "contentKey",content,version,created_at "createdAt",updated_at "updatedAt"`,
      [ownerId(), req.params.id, payload.label === undefined ? null : String(payload.label).trim(), Object.hasOwn(payload, 'contentKey'), payload.contentKey || null, Object.hasOwn(payload, 'content'), payload.content || null]);
      const body = updated.rows[0]; await addChange(client, 'navigationItem', body.id, 'upsert', body.version, body);
      return { status: 200, body };
    },
  }));
  res.status(result.status).json(result.body);
}));

router.delete('/notebooks/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res); if (!mutationId) return;
  const payload = { baseVersion: req.body?.baseVersion };
  if (!Number.isInteger(payload.baseVersion)) return res.status(400).json({ error: 'baseVersion is required' });
  const result = await inTransaction(async (client) => runIdempotent({ client, scope: `v1:delete-notebook:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await client.query('SELECT * FROM cms_navigation_items WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [ownerId(), req.params.id]);
      if (!current.rowCount) return { status: 404, body: { error: 'Notebook not found' } };
      if (current.rows[0].legacy_key === 'docs') return { status: 400, body: { error: 'Docs cannot be deleted' } };
      if (Number(current.rows[0].version) !== payload.baseVersion) return { status: 409, body: { error: 'Notebook version conflict', code: 'VERSION_CONFLICT' } };
      const version = payload.baseVersion + 1;
      await client.query('UPDATE cms_navigation_items SET deleted_at=now(),updated_at=now(),version=$3 WHERE owner_id=$1 AND id=$2', [ownerId(), req.params.id, version]);
      const affected = await client.query('UPDATE cms_notes SET notebook_id=NULL,version=version+1,updated_at=now() WHERE owner_id=$1 AND notebook_id=$2 AND deleted_at IS NULL RETURNING id', [ownerId(), req.params.id]);
      for (const row of affected.rows) {
        const note = await getNote(client, row.id);
        await addChange(client, 'note', note.id, 'upsert', note.version, note);
      }
      const affectedCategories = await client.query(`UPDATE cms_categories SET version=version+1,updated_at=now()
        WHERE owner_id=$1 AND deleted_at IS NULL AND id IN (SELECT category_id FROM cms_category_notebooks WHERE notebook_id=$2)
        RETURNING id`, [ownerId(), req.params.id]);
      await client.query('DELETE FROM cms_category_notebooks WHERE notebook_id=$1', [req.params.id]);
      for (const row of affectedCategories.rows) {
        const category = await getCategory(client, row.id);
        await addChange(client, 'category', category.id, 'upsert', category.version, category);
      }
      await addChange(client, 'navigationItem', req.params.id, 'delete', version, null);
      return { status: 200, body: { ok: true, id: req.params.id, version } };
    } }));
  res.status(result.status).json(result.body);
}));

const categorySelect = `SELECT c.id,c.legacy_key "legacyId",c.label,c.parent_id "parentId",c.version,c.created_at "createdAt",c.updated_at "updatedAt",
  COALESCE(array_agg(ni.id) FILTER (WHERE ni.id IS NOT NULL),'{}') "notebookIds"
  FROM cms_categories c LEFT JOIN cms_category_notebooks cn ON cn.category_id=c.id
  LEFT JOIN cms_navigation_items ni ON ni.id=cn.notebook_id AND ni.deleted_at IS NULL`;

const getCategory = async (client, id) => {
  const result = await client.query(`${categorySelect} WHERE c.owner_id=$1 AND c.id=$2 AND c.deleted_at IS NULL GROUP BY c.id`, [ownerId(), id]);
  return result.rows[0] || null;
};
const scopeWithinParent = (notebookIds, parent) => !parent || parent.notebookIds.length === 0
  || (notebookIds.length > 0 && notebookIds.every((id) => parent.notebookIds.includes(id)));

router.get('/categories', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`${categorySelect} WHERE c.owner_id=$1 AND c.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order`, [ownerId()]);
  res.json({ items: result.rows });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res); if (!mutationId) return;
  const payload = { ...req.body }; delete payload.mutationId;
  if (!String(payload.label || '').trim()) return res.status(400).json({ error: 'label is required' });
  if (payload.parentId && !isUuid(payload.parentId)) return res.status(400).json({ error: 'parentId must be a UUID' });
  if (payload.notebookIds !== undefined && !Array.isArray(payload.notebookIds)) return res.status(400).json({ error: 'notebookIds must be an array' });
  if ((payload.notebookIds || []).some((id) => !isUuid(id))) return res.status(400).json({ error: 'notebookIds must contain UUIDs' });
  const result = await inTransaction(async (client) => runIdempotent({ client, scope: 'v1:create-category', mutationId, payload,
    operation: async () => {
      const parent = payload.parentId ? await getCategory(client, payload.parentId) : null;
      if (payload.parentId && !parent) return { status: 400, body: { error: 'Parent category not found' } };
      const notebookIds = payload.notebookIds === undefined && parent ? parent.notebookIds : [...new Set(payload.notebookIds || [])];
      if (!scopeWithinParent(notebookIds, parent)) return { status: 400, body: { error: 'Subcategory notebook scope must be within its parent category' } };
      if (notebookIds.length) {
        const valid = await client.query('SELECT id FROM cms_navigation_items WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND kind=\'notebook\' AND deleted_at IS NULL', [ownerId(), notebookIds]);
        if (valid.rowCount !== notebookIds.length) return { status: 400, body: { error: 'Notebook not found' } };
      }
      const id = uuidv7(); const legacyId = `category-${id.slice(-12)}`;
      await client.query(`INSERT INTO cms_categories(id,owner_id,legacy_key,label,parent_id,sort_order)
        VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(sort_order),-1)+1 FROM cms_categories WHERE owner_id=$2))`, [id, ownerId(), legacyId, String(payload.label).trim(), payload.parentId || null]);
      for (const notebookId of notebookIds) await client.query('INSERT INTO cms_category_notebooks(category_id,notebook_id) VALUES($1,$2)', [id, notebookId]);
      const body = await getCategory(client, id); await addChange(client, 'category', id, 'upsert', 1, body);
      return { status: 201, body };
    } }));
  res.status(result.status).json(result.body);
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res); if (!mutationId) return;
  const payload = { ...req.body }; delete payload.mutationId;
  if (!Number.isInteger(payload.baseVersion)) return res.status(400).json({ error: 'baseVersion is required' });
  if (Object.hasOwn(payload, 'label') && !String(payload.label || '').trim()) return res.status(400).json({ error: 'label cannot be empty' });
  if (payload.parentId && !isUuid(payload.parentId)) return res.status(400).json({ error: 'parentId must be a UUID' });
  if (payload.notebookIds !== undefined && !Array.isArray(payload.notebookIds)) return res.status(400).json({ error: 'notebookIds must be an array' });
  if ((payload.notebookIds || []).some((id) => !isUuid(id))) return res.status(400).json({ error: 'notebookIds must contain UUIDs' });
  const result = await inTransaction(async (client) => runIdempotent({ client, scope: `v1:update-category:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const locked = await client.query('SELECT * FROM cms_categories WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [ownerId(), req.params.id]);
      if (!locked.rowCount) return { status: 404, body: { error: 'Category not found' } };
      if (Number(locked.rows[0].version) !== payload.baseVersion) return { status: 409, body: { error: 'Category version conflict', code: 'VERSION_CONFLICT' } };
      const currentCategory = await getCategory(client, req.params.id);
      let parent = currentCategory.parentId ? await getCategory(client, currentCategory.parentId) : null;
      if (Object.hasOwn(payload, 'parentId')) parent = payload.parentId ? await getCategory(client, payload.parentId) : null;
      if (payload.parentId) {
        const cycle = await client.query(`WITH RECURSIVE descendants AS (
          SELECT id FROM cms_categories WHERE owner_id=$1 AND parent_id=$2 AND deleted_at IS NULL
          UNION ALL SELECT c.id FROM cms_categories c JOIN descendants d ON c.parent_id=d.id WHERE c.owner_id=$1 AND c.deleted_at IS NULL
        ) SELECT 1 FROM descendants WHERE id=$3 UNION ALL SELECT 1 WHERE $2=$3 LIMIT 1`, [ownerId(), req.params.id, payload.parentId]);
        if (cycle.rowCount || !await getCategory(client, payload.parentId)) return { status: 400, body: { error: 'Invalid parent category' } };
      }
      const notebookIds = Object.hasOwn(payload, 'notebookIds') ? [...new Set(payload.notebookIds || [])] : null;
      if (!scopeWithinParent(notebookIds || currentCategory.notebookIds, parent)) return { status: 400, body: { error: 'Subcategory notebook scope must be within its parent category' } };
      if (notebookIds?.length) {
        const valid = await client.query('SELECT id FROM cms_navigation_items WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND kind=\'notebook\' AND deleted_at IS NULL', [ownerId(), notebookIds]);
        if (valid.rowCount !== notebookIds.length) return { status: 400, body: { error: 'Notebook not found' } };
      }
      await client.query(`UPDATE cms_categories SET label=COALESCE($3,label),parent_id=CASE WHEN $4 THEN $5::uuid ELSE parent_id END,
        version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2`, [ownerId(), req.params.id, payload.label === undefined ? null : String(payload.label).trim(), Object.hasOwn(payload, 'parentId'), payload.parentId || null]);
      if (notebookIds) {
        await client.query('DELETE FROM cms_category_notebooks WHERE category_id=$1', [req.params.id]);
        for (const notebookId of notebookIds) await client.query('INSERT INTO cms_category_notebooks(category_id,notebook_id) VALUES($1,$2)', [req.params.id, notebookId]);
      }
      const body = await getCategory(client, req.params.id); await addChange(client, 'category', body.id, 'upsert', body.version, body);
      return { status: 200, body };
    } }));
  res.status(result.status).json(result.body);
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res); if (!mutationId) return;
  const payload = { baseVersion: req.body?.baseVersion };
  if (!Number.isInteger(payload.baseVersion)) return res.status(400).json({ error: 'baseVersion is required' });
  const result = await inTransaction(async (client) => runIdempotent({ client, scope: `v1:delete-category:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await client.query('SELECT * FROM cms_categories WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [ownerId(), req.params.id]);
      if (!current.rowCount) return { status: 404, body: { error: 'Category not found' } };
      if (Number(current.rows[0].version) !== payload.baseVersion) return { status: 409, body: { error: 'Category version conflict', code: 'VERSION_CONFLICT' } };
      const remaining = await client.query('SELECT count(*)::int count FROM cms_categories WHERE owner_id=$1 AND deleted_at IS NULL AND id<>$2', [ownerId(), req.params.id]);
      if (!remaining.rows[0].count) return { status: 400, body: { error: 'At least one category is required' } };
      const fallback = await client.query(`SELECT id FROM cms_categories WHERE owner_id=$1 AND id<>$2 AND deleted_at IS NULL
        ORDER BY (legacy_key='uncategorized') DESC,sort_order LIMIT 1`, [ownerId(), req.params.id]);
      const version = payload.baseVersion + 1;
      const affectedChildren = await client.query(`UPDATE cms_categories SET parent_id=$3,version=version+1,updated_at=now()
        WHERE owner_id=$1 AND parent_id=$2 AND deleted_at IS NULL RETURNING id`, [ownerId(), req.params.id, current.rows[0].parent_id]);
      const affected = await client.query('UPDATE cms_notes SET category_id=$3,version=version+1,updated_at=now() WHERE owner_id=$1 AND category_id=$2 AND deleted_at IS NULL RETURNING id', [ownerId(), req.params.id, fallback.rows[0].id]);
      for (const row of affected.rows) {
        const note = await getNote(client, row.id);
        await addChange(client, 'note', note.id, 'upsert', note.version, note);
      }
      for (const row of affectedChildren.rows) {
        const category = await getCategory(client, row.id);
        await addChange(client, 'category', category.id, 'upsert', category.version, category);
      }
      await client.query('UPDATE cms_categories SET deleted_at=now(),updated_at=now(),version=$3 WHERE owner_id=$1 AND id=$2', [ownerId(), req.params.id, version]);
      await addChange(client, 'category', req.params.id, 'delete', version, null);
      return { status: 200, body: { ok: true, id: req.params.id, version, fallbackId: fallback.rows[0].id } };
    } }));
  res.status(result.status).json(result.body);
}));

router.get('/whiteboards', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`SELECT id,legacy_key "legacyId",content,archives,version,created_at "createdAt",updated_at "updatedAt"
    FROM cms_whiteboards WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [ownerId()]);
  res.json({ items: result.rows });
}));

router.get('/media', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`SELECT id,legacy_key "legacyId",original_name "originalName",mime,size_bytes "size",duration,width,height,url,poster_url "posterUrl",sha256,version,created_at "createdAt",updated_at "updatedAt"
    FROM cms_media_assets WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [ownerId()]);
  res.json({ items: result.rows });
}));

router.get('/attachments', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`SELECT id,path,original_name "originalName",mime,size_bytes "size",sha256,version,created_at "createdAt",updated_at "updatedAt"
    FROM cms_attachments WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [ownerId()]);
  res.json({ items: result.rows });
}));

router.put('/whiteboards/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res); if (!mutationId) return;
  const payload = { content: req.body?.content, baseVersion: req.body?.baseVersion };
  if (typeof payload.content !== 'string' || !Number.isInteger(payload.baseVersion)) return res.status(400).json({ error: 'content and baseVersion are required' });
  if (payload.content.length > 200000) return res.status(400).json({ error: 'Whiteboard content is too long' });
  const result = await inTransaction(async (client) => runIdempotent({ client, scope: `v1:update-whiteboard:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await client.query('SELECT * FROM cms_whiteboards WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [ownerId(), req.params.id]);
      if (!current.rowCount) return { status: 404, body: { error: 'Whiteboard not found' } };
      if (Number(current.rows[0].version) !== payload.baseVersion) return { status: 409, body: { error: 'Whiteboard version conflict', code: 'VERSION_CONFLICT', current: current.rows[0] } };
      const updated = await client.query(`UPDATE cms_whiteboards SET content=$3,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2
        RETURNING id,legacy_key "legacyId",content,archives,version,created_at "createdAt",updated_at "updatedAt"`, [ownerId(), req.params.id, payload.content]);
      const body = updated.rows[0]; await addChange(client, 'whiteboard', body.id, 'upsert', body.version, body);
      return { status: 200, body };
    } }));
  res.status(result.status).json(result.body);
}));

router.get('/notes', asyncHandler(async (_req, res) => {
  const result = await getCmsPool().query(`${noteSelect} WHERE n.owner_id=$1 AND n.deleted_at IS NULL
    GROUP BY n.id,nav.id,c.id ORDER BY n.pinned DESC,n.updated_at DESC`, [ownerId()]);
  res.json({ items: result.rows.map(noteFromRow) });
}));

router.get('/notes/:id', asyncHandler(async (req, res) => {
  const note = await getNote(getCmsPool(), req.params.id);
  return note ? res.json(note) : res.status(404).json({ error: 'Note not found' });
}));

router.post('/notes', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res);
  if (!mutationId) return;
  const payload = { ...req.body };
  delete payload.mutationId;
  if (!String(payload.title || '').trim()) return res.status(400).json({ error: 'title is required' });
  if (payload.notebookId && !isUuid(payload.notebookId)) return res.status(400).json({ error: 'notebookId must be a UUID' });
  if (payload.categoryId && !isUuid(payload.categoryId)) return res.status(400).json({ error: 'categoryId must be a UUID' });
  const result = await inTransaction(async (client) => runIdempotent({
    client, scope: 'v1:create-note', mutationId, payload,
    operation: async () => {
      const id = uuidv7();
      const notebook = payload.notebookId ? await client.query('SELECT id FROM cms_navigation_items WHERE owner_id=$1 AND id=$2 AND kind=\'notebook\' AND deleted_at IS NULL', [ownerId(), payload.notebookId]) : null;
      const category = payload.categoryId ? await client.query('SELECT id FROM cms_categories WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL', [ownerId(), payload.categoryId]) : null;
      if (payload.notebookId && !notebook?.rowCount) return { status: 400, body: { error: 'Notebook not found' } };
      if (payload.categoryId && !category?.rowCount) return { status: 400, body: { error: 'Category not found' } };
      if (!await categoryAcceptsNotebook(client, payload.categoryId, payload.notebookId)) return { status: 400, body: { error: 'Category does not belong to the selected notebook' } };
      const inserted = await client.query(`INSERT INTO cms_notes(id,owner_id,notebook_id,category_id,title,content,description,excerpt,note_date,read_time,starred,pinned,archived_at)
        VALUES($1,$2,$12,$13,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *`, [id, ownerId(), String(payload.title).trim(), String(payload.content || ''), String(payload.description || ''), String(payload.excerpt || ''),
        payload.date || null, payload.readTime || null, Boolean(payload.starred), Boolean(payload.pinned), payload.archivedAt || null,
        payload.notebookId || null, payload.categoryId || null]);
      if (!inserted.rows[0]) throw new Error('Unable to create note');
      for (const name of uniqueTags(payload.tags)) {
        const tag = await client.query(`INSERT INTO cms_tags(id,owner_id,name,normalized_name) VALUES($1,$2,$3,$4)
          ON CONFLICT(owner_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,deleted_at=NULL RETURNING id`, [uuidv7(), ownerId(), name, name.toLocaleLowerCase()]);
        await client.query('INSERT INTO cms_note_tags(note_id,tag_id) VALUES($1,$2)', [id, tag.rows[0].id]);
      }
      const note = await getNote(client, id);
      await addChange(client, 'note', id, 'upsert', note.version, note);
      return { status: 201, body: note };
    },
  }));
  res.status(result.status).json(result.body);
}));

router.put('/notes/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res);
  if (!mutationId) return;
  if (!Number.isInteger(req.body?.baseVersion) || req.body.baseVersion < 1) return res.status(400).json({ error: 'baseVersion is required' });
  const payload = { ...req.body };
  delete payload.mutationId;
  if (payload.notebookId && !isUuid(payload.notebookId)) return res.status(400).json({ error: 'notebookId must be a UUID' });
  if (payload.categoryId && !isUuid(payload.categoryId)) return res.status(400).json({ error: 'categoryId must be a UUID' });
  const result = await inTransaction(async (client) => runIdempotent({
    client, scope: `v1:update-note:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await getNote(client, req.params.id);
      if (!current) return { status: 404, body: { error: 'Note not found' } };
      if (current.version !== payload.baseVersion) return { status: 409, body: { error: 'Note version conflict', code: 'VERSION_CONFLICT', current } };
      if (payload.notebookId) {
        const valid = await client.query('SELECT 1 FROM cms_navigation_items WHERE owner_id=$1 AND id=$2 AND kind=\'notebook\' AND deleted_at IS NULL', [ownerId(), payload.notebookId]);
        if (!valid.rowCount) return { status: 400, body: { error: 'Notebook not found' } };
      }
      if (payload.categoryId) {
        const valid = await client.query('SELECT 1 FROM cms_categories WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL', [ownerId(), payload.categoryId]);
        if (!valid.rowCount) return { status: 400, body: { error: 'Category not found' } };
      }
      const nextNotebookId = Object.hasOwn(payload, 'notebookId') ? payload.notebookId || null : current.notebookId;
      const nextCategoryId = Object.hasOwn(payload, 'categoryId') ? payload.categoryId || null : current.categoryId;
      if (!await categoryAcceptsNotebook(client, nextCategoryId, nextNotebookId)) return { status: 400, body: { error: 'Category does not belong to the selected notebook' } };
      const result = await client.query(`UPDATE cms_notes SET
        title=COALESCE($3,title),content=COALESCE($4,content),description=COALESCE($5,description),excerpt=COALESCE($6,excerpt),
        notebook_id=CASE WHEN $7::boolean THEN $8::uuid ELSE notebook_id END,category_id=CASE WHEN $9::boolean THEN $10::uuid ELSE category_id END,
        starred=COALESCE($11,starred),pinned=COALESCE($12,pinned),archived_at=CASE WHEN $13::boolean THEN $14::timestamptz ELSE archived_at END,
        version=version+1,updated_at=now()
        WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING version`, [ownerId(), req.params.id,
        payload.title ?? null, payload.content ?? null, payload.description ?? null, payload.excerpt ?? null,
        Object.hasOwn(payload, 'notebookId'), payload.notebookId || null, Object.hasOwn(payload, 'categoryId'), payload.categoryId || null,
        payload.starred ?? null, payload.pinned ?? null, Object.hasOwn(payload, 'archivedAt'), payload.archivedAt || null]);
      if (!result.rowCount) return { status: 404, body: { error: 'Note not found' } };
      if (Array.isArray(payload.tags)) {
        await client.query('DELETE FROM cms_note_tags WHERE note_id=$1', [req.params.id]);
        for (const name of uniqueTags(payload.tags)) {
          const tag = await client.query(`INSERT INTO cms_tags(id,owner_id,name,normalized_name) VALUES($1,$2,$3,$4)
            ON CONFLICT(owner_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,deleted_at=NULL RETURNING id`, [uuidv7(), ownerId(), name, name.toLocaleLowerCase()]);
          await client.query('INSERT INTO cms_note_tags(note_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.id, tag.rows[0].id]);
        }
      }
      const note = await getNote(client, req.params.id);
      await addChange(client, 'note', note.id, 'upsert', note.version, note);
      return { status: 200, body: note };
    },
  }));
  res.status(result.status).json(result.body);
}));

router.delete('/notes/:id', asyncHandler(async (req, res) => {
  const mutationId = requireMutation(req, res);
  if (!mutationId) return;
  if (!Number.isInteger(req.body?.baseVersion) || req.body.baseVersion < 1) return res.status(400).json({ error: 'baseVersion is required' });
  const payload = { baseVersion: req.body.baseVersion };
  const result = await inTransaction(async (client) => runIdempotent({
    client, scope: `v1:delete-note:${req.params.id}`, mutationId, payload,
    operation: async () => {
      const current = await getNote(client, req.params.id);
      if (!current) return { status: 404, body: { error: 'Note not found' } };
      if (current.version !== payload.baseVersion) return { status: 409, body: { error: 'Note version conflict', code: 'VERSION_CONFLICT', current } };
      const version = current.version + 1;
      await client.query('UPDATE cms_notes SET deleted_at=now(),updated_at=now(),version=$3 WHERE owner_id=$1 AND id=$2', [ownerId(), req.params.id, version]);
      await addChange(client, 'note', req.params.id, 'delete', version, null);
      return { status: 200, body: { ok: true, id: req.params.id, version } };
    },
  }));
  res.status(result.status).json(result.body);
}));

export default router;

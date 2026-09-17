import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../../config/index.js';
import { getCmsPool } from './cmsPostgresDb.js';

const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const attachmentData = (row) => ({
  id: row.id, path: row.path, originalName: row.original_name, mime: row.mime,
  size: Number(row.size_bytes), sha256: row.sha256, version: Number(row.version),
  createdAt: row.created_at, updatedAt: row.updated_at,
});

const upsertAttachment = async (client, item) => {
  const existing = await client.query('SELECT * FROM cms_attachments WHERE owner_id=$1 AND path=$2 FOR UPDATE', [config.cms.ownerId, item.path]);
  const current = existing.rows[0];
  const differs = !current || current.sha256 !== item.sha256 || Number(current.size_bytes) !== Number(item.size)
    || current.mime !== (item.mime || null) || current.original_name !== (item.originalName || null) || current.deleted_at;
  const id = current?.id || uuidv7();
  const version = current ? Number(current.version) + (differs ? 1 : 0) : 1;
  const result = await client.query(`INSERT INTO cms_attachments(id,owner_id,path,original_name,mime,size_bytes,sha256,version,deleted_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)
    ON CONFLICT(owner_id,path) DO UPDATE SET original_name=EXCLUDED.original_name,mime=EXCLUDED.mime,size_bytes=EXCLUDED.size_bytes,
      sha256=EXCLUDED.sha256,version=EXCLUDED.version,updated_at=CASE WHEN cms_attachments.version<>EXCLUDED.version THEN now() ELSE cms_attachments.updated_at END,deleted_at=NULL
    RETURNING *`, [id, config.cms.ownerId, item.path, item.originalName || null, item.mime || null, Number(item.size || 0), item.sha256, version]);
  const data = attachmentData(result.rows[0]);
  if (differs) await client.query(`INSERT INTO cms_change_log(owner_id,entity_type,entity_id,operation,version,data)
    VALUES($1,'attachment',$2,'upsert',$3,$4::jsonb)`, [config.cms.ownerId, id, version, JSON.stringify(data)]);
  return data;
};

const recordCmsAttachment = async ({ file, path, originalName, mime, size }) => {
  if (config.cms.store !== 'postgres') return null;
  const item = { path, originalName, mime, size, sha256: await sha256File(file) };
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    const result = await upsertAttachment(client, item);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const deleteCmsAttachments = async (paths) => {
  if (config.cms.store !== 'postgres' || !paths.length) return;
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE cms_attachments SET deleted_at=now(),updated_at=now(),version=version+1
      WHERE owner_id=$1 AND path=ANY($2::text[]) AND deleted_at IS NULL RETURNING id,version`, [config.cms.ownerId, paths]);
    for (const row of result.rows) await client.query(`INSERT INTO cms_change_log(owner_id,entity_type,entity_id,operation,version,data)
      VALUES($1,'attachment',$2,'delete',$3,NULL)`, [config.cms.ownerId, row.id, row.version]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const syncCmsAttachments = async (items, { replace = false } = {}) => {
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    for (const item of items) await upsertAttachment(client, item);
    if (replace) {
      const livePaths = items.map((item) => item.path);
      const removed = await client.query(`UPDATE cms_attachments SET deleted_at=now(),updated_at=now(),version=version+1
        WHERE owner_id=$1 AND deleted_at IS NULL AND NOT(path=ANY($2::text[])) RETURNING id,version`, [config.cms.ownerId, livePaths]);
      for (const row of removed.rows) await client.query(`INSERT INTO cms_change_log(owner_id,entity_type,entity_id,operation,version,data)
        VALUES($1,'attachment',$2,'delete',$3,NULL)`, [config.cms.ownerId, row.id, row.version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export { sha256File, recordCmsAttachment, deleteCmsAttachments, syncCmsAttachments };

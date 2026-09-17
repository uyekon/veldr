import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.TEST_CMS_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const password = 'Phase2Test!2026';
let app;
let databases;
let Password;
let pool;
let closeCmsPool;
let runCmsMigrations;
let importPostgresDB;
let tempDir;

const fixture = () => ({
  notes: [{ id: 7, title: 'Migrated', content: 'body', desc: '', excerpt: 'body', category: 'work', notebookId: 'nb', tags: ['one'], version: 3, date: '2026-09-17' }],
  categories: [{ id: 'work', label: 'Work', parentId: null, notebookId: ['nb'] }],
  menus: [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'nb', label: 'Notebook', type: 'notebook' }],
  whiteboards: ['t', 'b', 'w', 'dp', 'n'].map((id) => ({ id, content: id === 'n' ? 'diary' : '', version: 1, updatedAt: null, archives: [] })),
  media: [], diaryConversions: {},
});

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veldr-cms-pg-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', CMS_STORE: 'postgres', CMS_DATABASE_URL: databaseUrl,
    DB_STORAGE: path.join(tempDir, 'main.sqlite'), SECURITY_DB_STORAGE: path.join(tempDir, 'security.sqlite'),
    CMS_DATA_DIR: path.join(tempDir, 'cms-data'), CMS_UPLOAD_DIR: path.join(tempDir, 'uploads'),
    JWT_SECRET: 'postgres-test-secret', DEFAULT_PASSWORD: password, ADMIN_USERNAME: 'admin',
    AUTH_COOKIE_NAME: 'veldr_auth', AUTH_COOKIE_SECURE: 'false',
  });
  ({ app } = await import('../app.js'));
  ({ databases } = await import('../config/databases.js'));
  ({ default: Password } = await import('../models/Password.js'));
  const postgresDb = await import('../modules/cms/cmsPostgresDb.js');
  pool = postgresDb.getCmsPool();
  closeCmsPool = postgresDb.closeCmsPool;
  runCmsMigrations = postgresDb.runCmsMigrations;
  ({ importPostgresDB } = await import('../modules/cms/cmsPostgresStore.js'));
  await databases.main.sync({ force: true });
  await databases.security.sync({ force: true });
  await runCmsMigrations();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE cms_change_log,cms_idempotency_records,cms_note_tags,cms_tags,cms_notes,cms_attachments,
    cms_category_notebooks,cms_categories,cms_navigation_items,cms_whiteboards,cms_media_assets,cms_users RESTART IDENTITY CASCADE`);
  await Password.destroy({ where: {}, truncate: true });
  await Password.create({ type: 'default', password: await bcrypt.hash(password, 4), isDefault: false, lastModified: new Date(), sessionVersion: 1 });
  await importPostgresDB(fixture());
});

afterAll(async () => {
  await closeCmsPool?.();
  await databases?.main.close();
  await databases?.security.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const editor = async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username: 'admin', password }).expect(200);
  return agent;
};

suite('CMS PostgreSQL compatibility and sync API', () => {
  it('preserves the legacy API while recording changes', async () => {
    const agent = await editor();
    await agent.get('/api/cms/notes/7').expect(200).expect(({ body }) => expect(body).toMatchObject({ id: 7, title: 'Migrated', version: 3 }));
    const created = await agent.post('/api/cms/notes').send({ title: 'Legacy create', content: 'text', category: 'work', notebookId: 'nb' }).expect(201);
    expect(created.body.id).toBe(8);
    const changes = await agent.get('/api/v1/cms/sync/changes?cursor=0').expect(200);
    expect(changes.body.changes.some((change) => change.entityType === 'note')).toBe(true);
  });

  it('supports idempotent UUID writes, conflicts, and tombstones', async () => {
    const agent = await editor();
    const bootstrap = await agent.get('/api/v1/cms/sync/bootstrap').expect(200);
    const notebookId = bootstrap.body.entities.notebooks.find((item) => item.legacyId === 'nb').id;
    const categoryId = bootstrap.body.entities.categories.find((item) => item.legacyId === 'work').id;
    const payload = { mutationId: 'create-note-test-0001', title: 'Synced', content: 'v1', notebookId, categoryId, tags: ['sync', 'SYNC'] };
    const [first, replay] = await Promise.all([
      agent.post('/api/v1/cms/notes').send(payload).expect(201),
      agent.post('/api/v1/cms/notes').send(payload).expect(201),
    ]);
    expect([first.body.replayed, replay.body.replayed].filter(Boolean)).toHaveLength(1);
    const original = first.body.replayed ? replay : first;
    const repeated = first.body.replayed ? first : replay;
    expect(repeated.body).toMatchObject({ id: original.body.id, replayed: true });
    expect(original.body.tags).toEqual(['sync']);
    await agent.put(`/api/v1/cms/notes/${original.body.id}`).send({ mutationId: 'update-note-test-0001', baseVersion: original.body.version, content: 'v2' }).expect(200);
    await agent.put(`/api/v1/cms/notes/${original.body.id}`).send({ mutationId: 'update-note-test-0002', baseVersion: original.body.version, content: 'stale' }).expect(409);
    const current = await agent.get(`/api/v1/cms/notes/${original.body.id}`).expect(200);
    await agent.delete(`/api/v1/cms/notes/${original.body.id}`).send({ mutationId: 'delete-note-test-0001', baseVersion: current.body.version }).expect(200);
    const changes = await agent.get(`/api/v1/cms/sync/changes?cursor=${bootstrap.body.cursor}`).expect(200);
    expect(changes.body.changes.at(-1)).toMatchObject({ entityType: 'note', entityId: original.body.id, operation: 'delete' });
    await agent.get('/api/v1/cms/notes/not-a-uuid').expect(400);
  });

  it('mutates notebook, category, and whiteboard metadata with versions', async () => {
    const agent = await editor();
    const notebook = await agent.post('/api/v1/cms/notebooks').send({ mutationId: 'create-notebook-0001', label: 'Mobile' }).expect(201);
    expect(notebook.body.version).toBe(1);
    const updatedNotebook = await agent.put(`/api/v1/cms/notebooks/${notebook.body.id}`).send({ mutationId: 'update-notebook-0001', baseVersion: 1, label: 'Mobile notes' }).expect(200);
    expect(updatedNotebook.body).toMatchObject({ label: 'Mobile notes', version: 2 });
    const category = await agent.post('/api/v1/cms/categories').send({ mutationId: 'create-category-0001', label: 'Trips', notebookIds: [notebook.body.id] }).expect(201);
    expect(category.body).toMatchObject({ label: 'Trips', version: 1, notebookIds: [notebook.body.id] });
    await agent.put(`/api/v1/cms/categories/${category.body.id}`).send({ mutationId: 'update-category-0001', baseVersion: 1, label: 'Travel' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ label: 'Travel', version: 2 }));
    const boards = await agent.get('/api/v1/cms/whiteboards').expect(200);
    const diary = boards.body.items.find((item) => item.legacyId === 'n');
    await agent.put(`/api/v1/cms/whiteboards/${diary.id}`).send({ mutationId: 'update-whiteboard-001', baseVersion: diary.version, content: 'offline-ready' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ content: 'offline-ready', version: diary.version + 1 }));
    await agent.delete(`/api/v1/cms/categories/${category.body.id}`).send({ mutationId: 'delete-category-0001', baseVersion: 2 }).expect(200);
    await agent.delete(`/api/v1/cms/notebooks/${notebook.body.id}`).send({ mutationId: 'delete-notebook-0001', baseVersion: 2 }).expect(200);
  });

  it('records uploaded images as syncable attachments', async () => {
    const agent = await editor();
    const upload = await agent.post('/api/cms/upload').attach('image', Buffer.from('phase-two-image'), { filename: 'sync.png', contentType: 'image/png' }).expect(201);
    const attachments = await agent.get('/api/v1/cms/attachments').expect(200);
    expect(attachments.body.items).toHaveLength(1);
    expect(attachments.body.items[0]).toMatchObject({ path: upload.body.url, originalName: 'sync.png', mime: 'image/png', size: 15, version: 1 });
    expect(attachments.body.items[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';

let app;
let databases;
let Password;
let resetDBForTests;
let cleanupCmsUploads;
let tempDir;
let cmsUploadDir;
const username = 'admin';
const password = '123456';

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veldr-cms-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_STORAGE: path.join(tempDir, 'veldr.sqlite'),
    SECURITY_DB_STORAGE: path.join(tempDir, 'security.sqlite'),
    CMS_DATA_DIR: path.join(tempDir, 'cms-data'), CMS_UPLOAD_DIR: path.join(tempDir, 'cms-uploads'),
    JWT_SECRET: 'test-secret', DEFAULT_PASSWORD: password, ADMIN_USERNAME: username,
  });
  ({ app } = await import('../app.js'));
  ({ databases } = await import('../config/databases.js'));
  ({ default: Password } = await import('../models/Password.js'));
  ({ resetDBForTests } = await import('../modules/cms/cmsStore.js'));
  ({ cleanupCmsUploads } = await import('../modules/cms/cmsMaintenance.js'));
  cmsUploadDir = path.join(tempDir, 'cms-uploads');
  await databases.main.sync({ force: true });
  await databases.security.sync({ force: true });
});

beforeEach(async () => {
  await Password.destroy({ where: {}, truncate: true });
  await Password.create({ type: 'default', password: await bcrypt.hash(password, 12), isDefault: true, lastModified: new Date(), sessionVersion: 1 });
  resetDBForTests({
    notes: [{ id: 1, title: 'CMS Note', category: 'work', notebookId: null, tags: ['cms'], content: 'CMS content', excerpt: 'CMS content', starred: false, date: '2026-07-23', readTime: '1 min', version: 1 }],
    menus: [{ id: 'docs', label: 'Docs', type: 'docs' }],
    categories: [{ id: 'work', label: 'Work' }],
  });
});

afterAll(async () => {
  await databases?.main?.close();
  await databases?.security?.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const editor = async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password }).expect(200);
  return agent;
};

describe('NoteFlow administrator access', () => {
  it('keeps reading public while rejecting editor key compatibility paths', async () => {
    await request(app).get('/api/cms/notes').expect(200).expect(({ body }) => expect(body).toHaveLength(1));
    await request(app).post('/api/cms/notes').set('X-Access-Key', password).send({ title: 'Blocked', content: 'Nope' }).expect(401);
    await request(app).post('/api/cms/auth').send({ key: password }).expect(404);
  });

  it('allows the shared administrator session to manage CMS content', async () => {
    const agent = await editor();
    const category = await agent.post('/api/cms/categories').send({ label: 'Health' }).expect(201);
    const note = await agent.post('/api/cms/notes').send({ title: 'New CMS Note', content: 'Hello', category: category.body.id, tags: ['one'], notebookId: null }).expect(201);
    await agent.put(`/api/cms/notes/${note.body.id}`).send({ title: 'Updated', version: note.body.version }).expect(200);
    await agent.delete(`/api/cms/notes/${note.body.id}`).expect(200);
  });

  it('requires a valid session for uploads and reports an oversized file', async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 0);
    await request(app).post('/api/cms/upload').attach('image', Buffer.from('image'), { filename: 'image.png', contentType: 'image/png' }).expect(401);
    const agent = await editor();
    await agent.post('/api/cms/upload').attach('image', oversized, { filename: 'too-large.png', contentType: 'image/png' }).expect(400)
      .expect(({ body }) => expect(body.code).toBe('FILE_TOO_LARGE'));
  });

  it('only removes upload files that are no longer referenced by any note', async () => {
    resetDBForTests({
      notes: [
        { id: 1, title: 'First', category: 'work', notebookId: null, tags: [], content: '![old](/uploads/cms/old.png) ![shared](/uploads/cms/shared.png)', version: 1 },
        { id: 2, title: 'Second', category: 'work', notebookId: null, tags: [], content: '![shared](/uploads/cms/shared.png)', version: 1 },
      ],
      menus: [{ id: 'docs', label: 'Docs', type: 'docs' }],
      categories: [{ id: 'work', label: 'Work' }],
    });
    await fs.mkdir(cmsUploadDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(cmsUploadDir, 'old.png'), 'old'),
      fs.writeFile(path.join(cmsUploadDir, 'shared.png'), 'shared'),
    ]);

    const agent = await editor();
    await agent.put('/api/cms/notes/1').send({ content: 'replacement', version: 1 }).expect(200);
    await expect(fs.access(path.join(cmsUploadDir, 'old.png'))).rejects.toThrow();
    await expect(fs.access(path.join(cmsUploadDir, 'shared.png'))).resolves.toBeUndefined();
  });

  it('cleans old orphaned uploads only for an authenticated editor', async () => {
    await fs.mkdir(cmsUploadDir, { recursive: true });
    const stale = path.join(cmsUploadDir, 'stale.png');
    const fresh = path.join(cmsUploadDir, 'fresh.png');
    const referenced = path.join(cmsUploadDir, 'referenced.png');
    await Promise.all([fs.writeFile(stale, 'stale'), fs.writeFile(fresh, 'fresh'), fs.writeFile(referenced, 'referenced')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(stale, old, old);
    await fs.utimes(referenced, old, old);
    resetDBForTests({
      notes: [{ id: 1, title: 'Reference', category: 'work', notebookId: null, tags: [], content: '![keep](/uploads/cms/referenced.png)', version: 1 }],
      menus: [{ id: 'docs', label: 'Docs', type: 'docs' }],
      categories: [{ id: 'work', label: 'Work' }],
    });

    await request(app).post('/api/cms/uploads/cleanup').expect(401);
    const agent = await editor();
    await agent.post('/api/cms/uploads/cleanup').expect(200)
      .expect(({ body }) => expect(body.removed).toContain('stale.png'));
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
    await expect(fs.access(referenced)).resolves.toBeUndefined();
  });

  it('lets the scheduled cleanup use the same grace period and reference rules', async () => {
    await fs.mkdir(cmsUploadDir, { recursive: true });
    const stale = path.join(cmsUploadDir, 'scheduled-stale.png');
    const fresh = path.join(cmsUploadDir, 'scheduled-fresh.png');
    await Promise.all([fs.writeFile(stale, 'stale'), fs.writeFile(fresh, 'fresh')]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.utimes(stale, old, old);

    const result = await cleanupCmsUploads();
    expect(result.removed).toContain('scheduled-stale.png');
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });

  it('uses the same authenticated session for the CMS identity endpoint', async () => {
    const agent = await editor();
    await agent.get('/api/cms/me').expect(200).expect(({ body }) => expect(body.role).toBe('editor'));
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/cms/me').expect(200).expect(({ body }) => expect(body.role).toBe('viewer'));
  });
});

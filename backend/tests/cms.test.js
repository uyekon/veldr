import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';

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

  it('persists pinned notes and returns them first in a filtered list', async () => {
    const agent = await editor();
    const older = await agent.post('/api/cms/notes').send({ title: 'Older', content: 'first' }).expect(201);
    await agent.post('/api/cms/notes').send({ title: 'Pinned', content: 'second', pinned: true }).expect(201);
    await agent.put(`/api/cms/notes/${older.body.id}`).send({ pinned: true, version: older.body.version }).expect(200);
    const notes = await agent.get('/api/cms/notes').expect(200);
    expect(notes.body.filter((note) => note.pinned).map((note) => note.title)).toEqual(['Pinned', 'Older']);
  });

  it('inherits subcategory notebook scope and repairs ancestor bindings from notes', async () => {
    resetDBForTests({
      notes: [],
      menus: [
        { id: 'docs', label: 'Docs', type: 'docs' },
        { id: 'notebook_docs', label: 'Docs notebook', type: 'notebook' },
        { id: 'notebook_goals', label: 'Goals notebook', type: 'notebook' },
      ],
      categories: [
        { id: 'project', label: 'Project', notebookId: ['notebook_docs'] },
      ],
    });
    const agent = await editor();

    const child = await agent.post('/api/cms/categories').send({ label: 'Tasks', parentId: 'project' }).expect(201);
    expect(child.body).toMatchObject({ parentId: 'project', notebookId: ['notebook_docs'] });

    await agent.post('/api/cms/categories').send({
      label: 'Invalid scope', parentId: 'project', notebookId: ['notebook_goals'],
    }).expect(400);
    await agent.put(`/api/cms/categories/${child.body.id}`).send({
      label: 'Tasks', notebookId: [],
    }).expect(400);

    await agent.post('/api/cms/notes').send({
      title: 'Legacy goal', content: 'Repair parent scope', category: child.body.id, notebookId: 'notebook_goals',
    }).expect(201);
    const categories = await agent.get('/api/cms/categories').expect(200);
    const byId = new Map(categories.body.map((category) => [category.id, category]));
    expect(byId.get('project').notebookId).toEqual(['notebook_docs', 'notebook_goals']);
    expect(byId.get(child.body.id).notebookId).toEqual(['notebook_docs', 'notebook_goals']);

    await agent.put('/api/cms/categories/project').send({ label: 'Project', parentId: child.body.id }).expect(400);
  });

  it('keeps t, b, w, and dp whiteboards independent and protects them from stale writes', async () => {
    await request(app).get('/api/cms/whiteboards').expect(401);
    await request(app).put('/api/cms/whiteboards/t').send({ content: 'blocked' }).expect(401);

    const agent = await editor();
    await agent.get('/api/cms/whiteboards').expect(200)
      .expect(({ body }) => expect(body.map((whiteboard) => whiteboard.id)).toEqual(['t', 'b', 'w', 'dp', 'n']));
    const t = await agent.put('/api/cms/whiteboards/t').send({ content: '买牛奶', version: 1 }).expect(200);
    const b = await agent.put('/api/cms/whiteboards/b').send({ content: '读书', version: 1 }).expect(200);
    const d = await agent.put('/api/cms/whiteboards/dp').send({ content: '推送', version: 1 }).expect(200);
    expect(t.body).toMatchObject({ id: 't', content: '买牛奶', version: 2 });
    expect(b.body).toMatchObject({ id: 'b', content: '读书', version: 2 });
    expect(d.body).toMatchObject({ id: 'dp', content: '推送', version: 2 });
    await agent.put('/api/cms/whiteboards/t').send({ content: 'stale', version: 1 }).expect(409);
    await agent.get('/api/cms/whiteboards/b').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: 'b', content: '读书', version: 2 }));
    await agent.get('/api/cms/whiteboards/dp').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: 'dp', content: '推送', version: 2 }));
    await agent.get('/api/cms/whiteboards/x').expect(404);

    await agent.get('/api/cms/whiteboard').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ content: '买牛奶', version: 2 }));
  });

  it('migrates dailyPush data to dp and keeps legacy API writes version-protected', async () => {
    const agent = await editor();
    const file = path.join(tempDir, 'cms-data', 'db.json');
    const archives = [{ id: 'saved', title: '历史快照', content: '旧正文', version: 6, createdAt: '2026-09-01T00:00:00.000Z' }];
    const board = { id: 'dailyPush', content: '保留推送内容', version: 7, updatedAt: '2026-09-02T00:00:00.000Z', archives };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ notes: [], menus: [], categories: [], media: [], whiteboards: [board] }));
    resetDBForTests();
    for (const id of ['dp', 'dailyPush']) {
      await agent.get(`/api/cms/whiteboards/${id}`).expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ id: 'dp', content: board.content, version: 7, updatedAt: board.updatedAt }));
    }
    await agent.put('/api/cms/whiteboards/dailyPush').send({ content: 'stale', version: 6 }).expect(409);
    await agent.put('/api/cms/whiteboards/dailyPush').send({ content: '新内容', version: 7 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: 'dp', version: 8 }));
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(stored.whiteboards.map(item => item.id)).toEqual(['t', 'b', 'w', 'dp', 'n']);
    expect(stored.whiteboards.find(item => item.id === 'dp').archives).toEqual(archives);
    resetDBForTests();
    await agent.get('/api/cms/whiteboards/dp').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ content: '新内容', version: 8 }));
  });

  it('archives the diary as an article and clears the whiteboard', async () => {
    resetDBForTests({
      notes: [],
      menus: [{ id: 'docs', label: 'Docs', type: 'docs' }, { id: 'notebook_work', label: '工作本', type: 'notebook' }],
      categories: [{ id: 'work', label: 'Work' }],
    });
    const agent = await editor();
    const diary = await agent.put('/api/cms/whiteboards/n').send({ content: '今天完成了一个重要目标', version: 1 }).expect(200);
    expect(diary.body).toMatchObject({ id: 'n', name: '日记', content: '今天完成了一个重要目标' });
    const archived = await agent.post('/api/cms/whiteboards/n/archive').send({
      title: '周一记录', notebookId: 'notebook_work', category: 'work', tags: ['journal'], version: diary.body.version, requestId: 'diary-conversion-test-1',
    }).expect(201);
    expect(archived.body.note).toMatchObject({ title: '周一记录', content: diary.body.content, notebookId: 'notebook_work', category: 'work', tags: ['journal'] });
    expect(archived.body.whiteboard).toMatchObject({ id: 'n', content: '', version: 3 });
    const replay = await agent.post('/api/cms/whiteboards/n/archive').send({
      title: '周一记录', notebookId: 'notebook_work', category: 'work', tags: ['journal'], version: diary.body.version, requestId: 'diary-conversion-test-1',
    }).expect(200);
    expect(replay.body.note.id).toBe(archived.body.note.id);
    expect(replay.body.replayed).toBe(true);
    await agent.post('/api/cms/whiteboards/n/archive').send({
      title: 'Changed', notebookId: 'notebook_work', category: 'work', version: diary.body.version, requestId: 'diary-conversion-test-1',
    }).expect(409);
  });

  it('rejects stale conversions and rolls back memory when persistence fails', async () => {
    resetDBForTests({ notes: [], menus: [{ id: 'nb', type: 'notebook', label: 'NB' }], categories: [{ id: 'work', label: 'Work' }] });
    const agent = await editor();
    await agent.put('/api/cms/whiteboards/n').send({ content: 'do not lose me', version: 1 }).expect(200);
    const payload = { title: 'Diary', notebookId: 'nb', category: 'work', version: 1, requestId: 'conversion-failure-test' };
    await agent.post('/api/cms/whiteboards/n/archive').send(payload).expect(409);
    await agent.post('/api/cms/whiteboards/n/archive').send({ title: 'old client' }).expect(400);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated disk failure'));
    try { await agent.post('/api/cms/whiteboards/n/archive').send({ ...payload, version: 2 }).expect(500); }
    finally { rename.mockRestore(); }
    await agent.get('/api/cms/whiteboards/n').expect(200).expect(({ body }) => expect(body.content).toBe('do not lose me'));
    await agent.get('/api/cms/notes').expect(200).expect(({ body }) => expect(body).toHaveLength(0));
    await agent.post('/api/cms/whiteboards/n/archive').send({ ...payload, version: 2 }).expect(201);
    resetDBForTests(); // Reload the persisted idempotency record as after a process restart.
    await agent.post('/api/cms/whiteboards/n/archive').send({ ...payload, version: 2 }).expect(200);
    await agent.get('/api/cms/notes').expect(200).expect(({ body }) => expect(body).toHaveLength(1));
  });

  it('serializes concurrent stale writes instead of losing a change', async () => {
    const agent = await editor();
    const results = await Promise.all(['one', 'two'].map(content => agent.put('/api/cms/whiteboards/n').send({ content, version: 1 })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  });

  it('exports private and archived notes only to editors', async () => {
    await request(app).get('/api/cms/export').expect(401);
    await request(app).get('/api/cms/notes/1/export').expect(401);
    const agent = await editor();
    await fs.mkdir(cmsUploadDir, { recursive: true });
    await fs.writeFile(path.join(cmsUploadDir, 'export.png'), 'image-fixture');
    await agent.put('/api/cms/notes/1').send({ tags: ['private', 'archived'], title: '中文 / 同名',
      content: 'CMS content ![image](/uploads/cms/export.png) ![missing](/uploads/cms/missing.png) [external](https://example.com/a.png)' }).expect(200);
    await agent.get('/api/cms/notes/1/export').expect(200).expect(({ text }) => {
      expect(text).toContain('private'); expect(text).toContain('CMS content');
    });
    const result = await agent.get('/api/cms/export').buffer(true).parse((res, callback) => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(result.body.subarray(0, 2).toString()).toBe('PK');
    const zip = path.join(tempDir, 'export.zip');
    await fs.writeFile(zip, result.body);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
    expect(manifest.missingAttachments).toContain('missing.png');
    expect(execFileSync('unzip', ['-p', zip, 'attachments/export.png'], { encoding: 'utf8' })).toBe('image-fixture');
    const markdown = execFileSync('unzip', ['-p', zip, '*.md'], { encoding: 'utf8' });
    expect(markdown).toContain('attachments/export.png'); expect(markdown).toContain('https://example.com/a.png');
  });

  it('does not replace a corrupt database with empty data', async () => {
    const agent = await editor();
    const file = path.join(tempDir, 'cms-data', 'db.json');
    for (const content of ['{corrupted', JSON.stringify({ notes: [null] }), JSON.stringify({ categories: 'invalid' }),
      JSON.stringify({ whiteboards: [{ id: 'dailyPush', content: 'old' }, { id: 'dp', content: 'new' }] })]) {
      await fs.writeFile(file, content); resetDBForTests();
      await agent.get('/api/cms/notes').expect(500);
      await agent.get('/api/cms/notes').expect(500);
      expect(await fs.readFile(file, 'utf8')).toBe(content);
    }
    // beforeEach seeds fresh memory for the next test.
  });

  it('keeps images still referenced by a whiteboard when deleting a note', async () => {
    const agent = await editor();
    await fs.mkdir(cmsUploadDir, { recursive: true });
    await fs.writeFile(path.join(cmsUploadDir, 'whiteboard.png'), 'keep');
    const content = '![image](/uploads/cms/whiteboard.png)';
    await agent.put('/api/cms/notes/1').send({ content }).expect(200);
    await agent.put('/api/cms/whiteboards/n').send({ content, version: 1 }).expect(200);
    await agent.delete('/api/cms/notes/1').expect(200);
    expect(await fs.readFile(path.join(cmsUploadDir, 'whiteboard.png'), 'utf8')).toBe('keep');
  });

  it('hides archived notes unless the archived tag is explicitly filtered', async () => {
    const agent = await editor();
    const note = await agent.post('/api/cms/notes').send({ title: 'Old note', content: 'old', tags: ['archived'] }).expect(201);
    await agent.post('/api/cms/notes').send({ title: 'Current note', content: 'current' }).expect(201);
    await agent.get('/api/cms/notes').expect(200).expect(({ body }) => expect(body.map(({ id }) => id)).not.toContain(note.body.id));
    await agent.get('/api/cms/notes?tag=archived').expect(200).expect(({ body }) => expect(body.map(({ id }) => id)).toContain(note.body.id));
    await agent.put(`/api/cms/notes/${note.body.id}`).send({ tags: ['archived', 'work'], version: note.body.version }).expect(200);
    await agent.get('/api/cms/notes?tag=work').expect(200).expect(({ body }) => expect(body.map(({ id }) => id)).not.toContain(note.body.id));
  });

  it('migrates the legacy whiteboard into t', async () => {
    resetDBForTests({
      notes: [],
      menus: [{ id: 'docs', label: 'Docs', type: 'docs' }],
      categories: [{ id: 'work', label: 'Work' }],
      whiteboard: { content: '旧白板内容', version: 4, updatedAt: '2026-08-01T00:00:00.000Z' },
    });

    const agent = await editor();
    await agent.get('/api/cms/whiteboards/t').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: 't', content: '旧白板内容', version: 4 }));
    await agent.get('/api/cms/whiteboards/b').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: 'b', content: '', version: 1 }));
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

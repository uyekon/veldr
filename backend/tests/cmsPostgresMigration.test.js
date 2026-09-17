import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditAttachments, contentDigest, normalize, validate } from '../scripts/cms-postgres-migrate.js';

const base = () => ({
  notes: [{ id: 1, title: 'One', content: 'Body', category: 'work', notebookId: 'nb', tags: ['tag'], version: 1 }],
  categories: [{ id: 'work', label: 'Work', notebookId: ['nb'] }],
  menus: [{ id: 'nb', label: 'Notebook', type: 'notebook' }],
  whiteboards: [{ id: 'dailyPush', content: 'push', version: 2 }],
  media: [],
});

describe('CMS PostgreSQL migration validation', () => {
  it('normalizes legacy whiteboards and creates missing standard boards', () => {
    const database = normalize(base());
    expect(database.whiteboards.map((item) => item.id).sort()).toEqual(['b', 'dp', 'n', 't', 'w']);
    expect(validate(database)).toMatchObject({ ok: true, counts: { notes: 1, categories: 1, menus: 1, whiteboards: 5 } });
  });

  it('rejects duplicate IDs, category cycles, and missing references', () => {
    const database = normalize(base());
    database.notes.push({ ...database.notes[0], notebookId: 'missing' });
    database.categories.push({ id: 'child', label: 'Child', parentId: 'child', notebookId: [] });
    const report = validate(database);
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/duplicate id|cycle|missing notebook/);
  });

  it('uses an order-independent digest for business data', () => {
    const first = normalize(base());
    const second = structuredClone(first);
    second.whiteboards.reverse();
    second.notes[0].pinned = false;
    second.notes[0].desc = '';
    expect(contentDigest(second)).toBe(contentDigest(first));
    second.notes[0].content = 'changed';
    expect(contentDigest(second)).not.toBe(contentDigest(first));
  });

  it('hashes referenced attachments and reports missing files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veldr-attachment-audit-'));
    try {
      await fs.mkdir(path.join(root, 'videos'));
      await fs.writeFile(path.join(root, 'image.png'), 'image');
      const database = normalize(base());
      database.notes[0].content = '![ok](/uploads/cms/image.png) ![missing](/uploads/cms/missing.png)';
      const report = await auditAttachments(database, root);
      expect(report.items).toHaveLength(1);
      expect(report.items[0]).toMatchObject({ path: '/uploads/cms/image.png', size: 5, mime: 'image/png' });
      expect(report.missing).toEqual(['/uploads/cms/missing.png']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

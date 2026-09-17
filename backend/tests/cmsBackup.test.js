import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBackup, verifyBackup, restoreBackup } from '../modules/cms/cmsBackup.js';

it('verifies every file, previews without writes, and restores data plus nested attachments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-backup-test-'));
  try {
    const dbFile = path.join(root, 'data', 'db.json'); const uploadDir = path.join(root, 'uploads'); const backupDir = path.join(root, 'backups');
    await fs.mkdir(path.dirname(dbFile)); await fs.mkdir(path.join(uploadDir, 'videos'), { recursive: true });
    const db = { notes: [{ id: 1, content: 'hello' }], menus: [], categories: [], whiteboards: [{ id: 'n', content: 'draft' }], media: [] };
    await fs.writeFile(dbFile, JSON.stringify(db)); await fs.writeFile(path.join(uploadDir, 'videos', 'video.mp4'), 'fixture');
    const source = await createBackup({ dbFile, uploadDir, backupDir });
    expect((await verifyBackup(source)).db).toEqual(db);
    await fs.writeFile(dbFile, JSON.stringify({ ...db, notes: [] }));
    await fs.writeFile(path.join(uploadDir, 'videos', 'video.mp4'), 'changed');
    const preview = await restoreBackup({ source, dbFile, uploadDir, backupDir });
    expect(preview.dryRun).toBe(true);
    expect(JSON.parse(await fs.readFile(dbFile, 'utf8')).notes).toEqual([]);
    const result = await restoreBackup({ source, dbFile, uploadDir, backupDir, apply: true });
    expect(result.restored).toBe(true);
    expect(JSON.parse(await fs.readFile(dbFile, 'utf8'))).toEqual(db);
    expect(await fs.readFile(path.join(uploadDir, 'videos', 'video.mp4'), 'utf8')).toBe('fixture');
    expect((await verifyBackup(result.safetyBackup)).db.notes).toEqual([]);
    await fs.writeFile(path.join(source, 'uploads', 'videos', 'video.mp4'), 'tampered');
    await expect(verifyBackup(source)).rejects.toThrow('Checksum mismatch');
    await expect(restoreBackup({ source, dbFile, uploadDir, backupDir, apply: true })).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(dbFile, 'utf8'))).toEqual(db);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

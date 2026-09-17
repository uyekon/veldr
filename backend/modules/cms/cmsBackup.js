import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withCmsLock } from './cmsLock.js';

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${name}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported file: ${name}`);
  }
  return files.sort();
}

function validateData(db) {
  if (!db || !['notes', 'categories', 'menus', 'whiteboards', 'media'].every(key => Array.isArray(db[key]))) {
    throw new Error('Invalid CMS backup data');
  }
  for (const key of ['notes', 'categories', 'menus', 'whiteboards']) {
    if (new Set(db[key].map(item => item.id)).size !== db[key].length) throw new Error(`Duplicate ${key} IDs`);
  }
  return db;
}

export async function verifyBackup(directory) {
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Backup directory must not be a symlink');
  const files = await listFiles(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.files || !Object.hasOwn(manifest.files, 'db.json')) throw new Error('Unsupported backup');
  if (JSON.stringify(files.filter(name => name !== 'manifest.json')) !== JSON.stringify(Object.keys(manifest.files).sort())) {
    throw new Error('Backup file inventory mismatch');
  }
  for (const file of files.filter(name => name !== 'manifest.json')) {
    if (file !== 'db.json' && !file.startsWith('uploads/')) throw new Error('Invalid backup path');
    if (await hashFile(path.join(directory, file)) !== manifest.files[file]) throw new Error(`Checksum mismatch: ${file}`);
  }
  const db = validateData(JSON.parse(await fs.readFile(path.join(directory, 'db.json'), 'utf8')));
  for (const key of ['notes', 'categories', 'menus', 'whiteboards', 'media']) {
    if (manifest.counts?.[key] !== db[key].length) throw new Error(`Backup count mismatch: ${key}`);
  }
  return { manifest, db };
}

export async function createBackup({ dbFile, uploadDir, backupDir, kind = 'manual', locked = false }) {
  if (!['daily', 'manual', 'release', 'restore'].includes(kind)) throw new Error('Invalid backup kind');
  for (const protectedRoot of [path.dirname(dbFile), uploadDir]) {
    const relative = path.relative(path.resolve(protectedRoot), path.resolve(backupDir));
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Backup directory must be outside runtime data and uploads');
    }
  }
  const run = async () => {
    await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const name = `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const pending = path.join(backupDir, `.${name}.partial`);
    const target = path.join(backupDir, name);
    await fs.mkdir(pending, { mode: 0o700 });
    try {
      const db = validateData(JSON.parse(await fs.readFile(dbFile, 'utf8')));
      await fs.writeFile(path.join(pending, 'db.json'), JSON.stringify(db, null, 2), { mode: 0o600 });
      await fs.mkdir(path.join(pending, 'uploads'));
      // Copy every attachment, including media library files and whiteboard references.
      for (const file of await listFiles(uploadDir)) {
        const destination = path.join(pending, 'uploads', file);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(uploadDir, file), destination);
      }
      const hashes = {};
      for (const file of await listFiles(pending)) hashes[file] = await hashFile(path.join(pending, file));
      await fs.writeFile(path.join(pending, 'manifest.json'), JSON.stringify({
        format: 1, kind, createdAt: new Date().toISOString(), files: hashes,
        counts: Object.fromEntries(['notes', 'categories', 'menus', 'whiteboards', 'media'].map(key => [key, db[key].length])),
      }, null, 2), { mode: 0o600 });
      await verifyBackup(pending);
      await fs.rename(pending, target);
      return target;
    } catch (error) {
      await fs.rm(pending, { recursive: true, force: true });
      throw error;
    }
  };
  return locked ? run() : withCmsLock(path.dirname(dbFile), run);
}

export async function pruneBackups(backupDir) {
  const groups = { daily: [], safety: [] };
  for (const entry of await fs.readdir(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^(daily|release|restore)-/.test(entry.name)) continue;
    const directory = path.join(backupDir, entry.name);
    try {
      const { manifest } = await verifyBackup(directory);
      groups[manifest.kind === 'daily' ? 'daily' : 'safety'].push({ directory, at: manifest.createdAt });
    } catch { /* Never remove an unrecognized or damaged backup automatically. */ }
  }
  for (const [group, keep] of [[groups.daily, 14], [groups.safety, 5]]) {
    group.sort((a, b) => b.at.localeCompare(a.at));
    for (const item of group.slice(keep)) await fs.rm(item.directory, { recursive: true });
  }
}

export async function restoreBackup({ source, dbFile, uploadDir, backupDir, apply = false }) {
  const verified = await verifyBackup(source);
  if (!apply) return { dryRun: true, counts: verified.manifest.counts, dbFile, uploadDir };
  // Caller must stop the backend and cleanup timer before applying, because
  // the server caches committed data. Lock also excludes backup/cleanup jobs.
  return withCmsLock(path.dirname(dbFile), async () => {
    for (const target of [dbFile, uploadDir]) {
      const resolved = path.resolve(target);
      if (resolved.split(path.sep).filter(Boolean).length < 3 || resolved === process.env.HOME) throw new Error('Unsafe restore target');
    }
    const safety = await createBackup({ dbFile, uploadDir, backupDir, kind: 'restore', locked: true });
    const suffix = `.restore-${randomUUID()}`;
    const stagedData = dbFile + suffix;
    const stagedUploads = uploadDir + suffix;
    const oldData = dbFile + suffix + '.previous';
    const oldUploads = uploadDir + suffix + '.previous';
    await fs.copyFile(path.join(source, 'db.json'), stagedData);
    await fs.cp(path.join(source, 'uploads'), stagedUploads, { recursive: true });
    let movedData = false; let movedUploads = false; let installedData = false; let installedUploads = false;
    try {
      await fs.rename(dbFile, oldData); movedData = true;
      await fs.rename(uploadDir, oldUploads); movedUploads = true;
      await fs.rename(stagedUploads, uploadDir); installedUploads = true;
      await fs.rename(stagedData, dbFile); installedData = true;
    } catch (error) {
      if (installedData) await fs.rename(dbFile, stagedData);
      if (installedUploads) await fs.rename(uploadDir, stagedUploads);
      if (movedUploads) await fs.rename(oldUploads, uploadDir);
      if (movedData) await fs.rename(oldData, dbFile);
      throw error;
    }
    return { restored: true, safetyBackup: safety, previousData: oldData, previousUploads: oldUploads, counts: verified.manifest.counts };
  });
}

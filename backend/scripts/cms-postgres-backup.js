#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { closeCmsPool, getCmsPool } from '../modules/cms/cmsPostgresDb.js';

const run = promisify(execFile);
const args = process.argv.slice(2);
const command = args[0];
const has = (name) => args.includes(`--${name}`);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const backupRoot = path.resolve(option('backup-dir', process.env.CMS_POSTGRES_BACKUP_DIR || '/opt/veldr/backups/cms-postgres'));
const uploadDir = path.resolve(option('upload-dir', path.resolve(process.cwd(), config.cms.uploadDir)));
const digestFile = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const postgresCommandEnv = (databaseUrl) => {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password || '');
  parsed.password = '';
  return { databaseUrl: parsed.toString(), env: password ? { ...process.env, PGPASSWORD: password } : process.env };
};
const assertSafeUploadTarget = (target) => {
  const resolved = path.resolve(target);
  const forbidden = new Set(['/', process.cwd(), path.resolve(process.cwd(), '..')]);
  if (forbidden.has(resolved) || resolved.length < 12) throw new Error('Refusing unsafe --target-upload-dir');
  return resolved;
};

const filesUnder = async (root, relative = '') => {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in backups: ${name}`);
    if (entry.isDirectory()) result.push(...await filesUnder(root, name));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
};

const createManifest = async (directory) => {
  const files = await filesUnder(directory);
  const entries = [];
  for (const name of files) {
    if (name === 'manifest.json') continue;
    const file = path.join(directory, name);
    const stat = await fs.stat(file);
    entries.push({ path: name.split(path.sep).join('/'), size: stat.size, sha256: await digestFile(file) });
  }
  return { format: 2, kind: 'veldr-cms-postgres', createdAt: new Date().toISOString(), files: entries };
};

const verify = async (source) => {
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.kind !== 'veldr-cms-postgres' || manifest.format !== 2) throw new Error('Unsupported backup manifest');
  const actual = (await filesUnder(source)).filter((name) => name !== 'manifest.json').map((name) => name.split(path.sep).join('/'));
  const expected = manifest.files.map((item) => item.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Backup file list does not match its manifest');
  for (const item of manifest.files) {
    const file = path.join(source, item.path);
    const stat = await fs.stat(file);
    if (stat.size !== item.size || await digestFile(file) !== item.sha256) throw new Error(`Backup verification failed: ${item.path}`);
  }
  await run('pg_restore', ['--list', path.join(source, 'database.dump')]);
  return manifest;
};

const backup = async () => {
  if (!config.cms.databaseUrl) throw new Error('CMS_DATABASE_URL is required');
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupRoot, `backup-${stamp}-${randomUUID()}`);
  const partial = `${target}.partial`;
  await fs.mkdir(partial, { mode: 0o700 });
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await client.query('SELECT pg_export_snapshot() snapshot');
    const pg = postgresCommandEnv(config.cms.databaseUrl);
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--snapshot=${snapshot.rows[0].snapshot}`, '--file', path.join(partial, 'database.dump'), pg.databaseUrl], { env: pg.env, maxBuffer: 10 * 1024 * 1024 });
    await fs.cp(uploadDir, path.join(partial, 'uploads'), { recursive: true, force: false, errorOnExist: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await client.query('COMMIT');
    const manifest = await createManifest(partial);
    await fs.writeFile(path.join(partial, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await verify(partial);
    await fs.rename(partial, target);
    if (process.env.RESTIC_REPOSITORY && process.env.RESTIC_PASSWORD_FILE) {
      await run('restic', ['backup', '--tag', 'veldr-cms-postgres', target], { env: process.env, maxBuffer: 10 * 1024 * 1024 });
      await run('restic', ['forget', '--tag', 'veldr-cms-postgres', '--keep-daily', '14', '--keep-weekly', '8', '--keep-monthly', '12', '--prune'], { env: process.env, maxBuffer: 10 * 1024 * 1024 });
    }
    console.log(JSON.stringify({ ok: true, target, remote: Boolean(process.env.RESTIC_REPOSITORY), files: manifest.files.length }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await fs.rm(partial, { recursive: true, force: true });
    throw error;
  } finally {
    client.release();
  }
};

const restore = async () => {
  const source = path.resolve(option('source', ''));
  const targetUrl = option('target-url', config.cms.databaseUrl);
  if (!source || !targetUrl) throw new Error('--source and --target-url (or CMS_DATABASE_URL) are required');
  const manifest = await verify(source);
  if (!has('apply')) {
    console.log(JSON.stringify({ ok: true, dryRun: true, source, targetUrl: targetUrl.replace(/:[^:@/]+@/, ':***@'), files: manifest.files.length }, null, 2));
    return;
  }
  if (option('confirm') !== 'REPLACE_CMS_POSTGRES') throw new Error('--confirm REPLACE_CMS_POSTGRES is required');
  const pg = postgresCommandEnv(targetUrl);
  await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname', pg.databaseUrl, path.join(source, 'database.dump')], { env: pg.env, maxBuffer: 10 * 1024 * 1024 });
  const targetUploadsOption = option('target-upload-dir', null);
  if (targetUploadsOption) {
    const targetUploads = assertSafeUploadTarget(targetUploadsOption);
    const incoming = `${targetUploads}.restore-${randomUUID()}`;
    const backupUploads = path.join(source, 'uploads');
    await fs.cp(backupUploads, incoming, { recursive: true }).catch(async (error) => {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(incoming, { recursive: true, mode: 0o700 });
    });
    let previous = `${targetUploads}.previous-${Date.now()}`;
    await fs.rename(targetUploads, previous).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      previous = null;
    });
    await fs.rename(incoming, targetUploads);
    console.log(JSON.stringify({ ok: true, restored: source, previousUploads: previous }, null, 2));
  } else {
    console.log(JSON.stringify({ ok: true, restored: source, uploads: 'not restored (no --target-upload-dir)' }, null, 2));
  }
};

const main = async () => {
  if (command === 'backup') return backup();
  if (command === 'verify') return console.log(JSON.stringify({ ok: true, manifest: await verify(path.resolve(option('source', ''))) }, null, 2));
  if (command === 'restore') return restore();
  throw new Error('Usage: cms-postgres-backup.js backup|verify|restore [options]');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(closeCmsPool);
}

export { assertSafeUploadTarget, createManifest, verify };

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyRelease(source) {
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || !manifest.files) throw new Error('Invalid release manifest');
  const actual = [];
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
      else if (entry.isFile()) { if (name !== 'manifest.json') actual.push(name); }
      else throw new Error('Release symlinks are forbidden');
    }
  }
  await walk(source);
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Release file inventory mismatch');
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!/^(backend|dist)\//.test(name) || name.split('/').includes('..')) throw new Error('Invalid release path');
    const file = path.join(source, name);
    if (!(await fs.lstat(file)).isFile()) throw new Error('Release symlinks are forbidden');
    if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== hash) throw new Error(`Release checksum mismatch: ${name}`);
  }
  return manifest;
}

// An injected service hook lets the exact activation/rollback algorithm be
// exercised against disposable directories without touching production.
export async function activateRelease({ source, backend, frontend, prepare, stop, start, check }) {
  const manifest = await verifyRelease(source);
  const suffix = `.release-${manifest.commit.slice(0, 8)}-${randomUUID()}`;
  for (const target of [backend, frontend]) {
    if (!path.isAbsolute(target) || target.split(path.sep).filter(Boolean).length < 3) throw new Error('Explicit, narrow absolute target paths required');
  }
  const previousBackend = backend + suffix + '.previous';
  const previousFrontend = frontend + suffix + '.previous';
  const stagedBackend = backend + suffix;
  const stagedFrontend = frontend + suffix;
  await fs.cp(path.join(source, 'backend'), stagedBackend, { recursive: true });
  await fs.cp(path.join(source, 'dist'), stagedFrontend, { recursive: true });
  await prepare(stagedBackend);
  // Runtime data/config stay in the previous directory; keep that directory.
  // Existing symlinks are resolved so repeated releases retain stable targets.
  for (const name of ['.env', 'public', 'var', 'temp', 'logs']) {
    const current = path.join(backend, name);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const runtime = stat.isSymbolicLink() ? await fs.realpath(current) : path.join(previousBackend, name);
    await fs.rm(path.join(stagedBackend, name), { recursive: true, force: true });
    await fs.symlink(runtime, path.join(stagedBackend, name));
  }
  let movedBackend = false; let movedFrontend = false; let installedBackend = false; let installedFrontend = false;
  await stop();
  try {
    await fs.rename(backend, previousBackend); movedBackend = true;
    await fs.rename(frontend, previousFrontend); movedFrontend = true;
    await fs.rename(stagedBackend, backend); installedBackend = true;
    await fs.rename(stagedFrontend, frontend); installedFrontend = true;
    await start(); await check(manifest);
  } catch (error) {
    await stop();
    if (installedFrontend) await fs.rename(frontend, stagedFrontend);
    if (installedBackend) await fs.rename(backend, stagedBackend);
    if (movedFrontend) await fs.rename(previousFrontend, frontend);
    if (movedBackend) await fs.rename(previousBackend, backend);
    await start();
    throw new Error(`Release failed; previous application restored. ${error.message}`);
  }
  return { commit: manifest.commit, backend, frontend, previousBackend, previousFrontend };
}

export async function rollbackRelease({ backend, frontend, previousBackend, previousFrontend, stop, start, check }) {
  const targets = [backend, frontend, previousBackend, previousFrontend];
  if (new Set(targets.map(target => path.resolve(target))).size !== 4) throw new Error('Rollback directories must be distinct');
  for (const target of [backend, frontend, previousBackend, previousFrontend]) {
    if (!path.isAbsolute(target) || target.split(path.sep).filter(Boolean).length < 3) throw new Error('Invalid rollback target');
    await fs.access(target);
  }
  // Runtime remains in its original owner directory. Moving that owner back
  // restores its original path on the first release; later releases link to it.
  const suffix = `.rolled-back-${randomUUID()}`;
  let movedBackend = false; let movedFrontend = false; let installedBackend = false; let installedFrontend = false;
  await stop();
  try {
    await fs.rename(backend, backend + suffix); movedBackend = true;
    await fs.rename(frontend, frontend + suffix); movedFrontend = true;
    await fs.rename(previousBackend, backend); installedBackend = true;
    await fs.rename(previousFrontend, frontend); installedFrontend = true;
    await start(); await check();
  } catch (error) {
    await stop();
    if (installedFrontend) await fs.rename(frontend, previousFrontend);
    if (installedBackend) await fs.rename(backend, previousBackend);
    if (movedFrontend) await fs.rename(frontend + suffix, frontend);
    if (movedBackend) await fs.rename(backend + suffix, backend);
    await start();
    throw new Error(`Rollback failed; current application restored. ${error.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = key => args[args.indexOf(key) + 1];
  try {
    if (!['activate', 'rollback'].includes(args[0])) throw new Error('Use activate or rollback');
    if (args[0] === 'activate' && !args.includes('--source')) throw new Error('--source required');
    if (args[0] === 'rollback' && (!args.includes('--previous-backend') || !args.includes('--previous-frontend'))) throw new Error('Previous directories required');
    for (const flag of ['--backend', '--frontend', '--service', '--health-url', '--site-url']) if (!args.includes(flag)) throw new Error(`Missing ${flag}`);
    const backend = path.resolve(get('--backend')); const frontend = path.resolve(get('--frontend'));
    const service = get('--service');
    if (!/^[a-zA-Z0-9_.@-]+$/.test(service)) throw new Error('Invalid service name');
    const hooks = {
      stop: async () => { execFileSync('systemctl', ['stop', service]); },
      start: async () => { execFileSync('systemctl', ['start', service]); },
      check: async manifest => {
        let last;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            execFileSync('curl', ['-fsS', '--max-time', '5', get('--health-url')], { stdio: 'ignore' });
            execFileSync('curl', ['-fsS', '--max-time', '5', get('--site-url')], { stdio: 'ignore' });
            if (manifest) {
              const published = JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '5', new URL('release.json', get('--site-url')).href], { encoding: 'utf8' }));
              if (published.commit !== manifest.commit) throw new Error('Published frontend version mismatch');
              if (JSON.parse(await fs.readFile(path.join(backend, 'release.json'))).commit !== manifest.commit) throw new Error('Backend version mismatch');
            }
            return;
          } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 1000)); }
        }
        throw last;
      },
    };
    execFileSync('df', ['-Pk', backend, frontend], { stdio: 'inherit' });
    const nginx = execFileSync('nginx', ['-T'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!nginx.includes(`root ${frontend};`)) throw new Error('Frontend path does not match an Nginx root');
    execFileSync('systemctl', ['is-active', service], { stdio: 'ignore' });
    const previousCwd = process.cwd();
    process.chdir(backend);
    const { config } = await import(pathToFileURL(path.join(backend, 'config/index.js')).href);
    process.chdir(previousCwd);
    const backupModule = args[0] === 'activate'
      ? path.join(path.resolve(get('--source')), 'backend/modules/cms/cmsBackup.js') : path.join(backend, 'modules/cms/cmsBackup.js');
    if (args[0] === 'activate' && args.includes('--source')) {
      const source = path.resolve(get('--source'));
      await verifyRelease(source);
      let required = 0;
      for (const file of Object.keys(JSON.parse(await fs.readFile(path.join(source, 'manifest.json'))).files)) required += (await fs.stat(path.join(source, file))).size;
      for (const target of [backend, frontend]) {
        const space = await fs.statfs(target);
        if (space.bavail * space.bsize < required * 3 + 512 * 1024 * 1024) throw new Error('Insufficient release staging space');
      }
    }
    // Incoming releases have no node_modules yet; this module uses only Node
    // built-ins. Resolve data paths from the live config, not incoming defaults.
    const { createBackup, pruneBackups } = await import(pathToFileURL(backupModule).href);
    const backupDir = path.resolve(backend, '../backups/cms');
    const savedBackup = await createBackup({
      dbFile: path.join(path.resolve(backend, config.cms.dataDir), config.cms.dbFile),
      uploadDir: path.resolve(backend, config.cms.uploadDir), backupDir, kind: 'release',
    });
    console.log(`Pre-release backup: ${savedBackup}`);
    await pruneBackups(backupDir);
    if (args[0] === 'activate') {
      if (!args.includes('--source')) throw new Error('--source required');
      const result = await activateRelease({ source: path.resolve(get('--source')), backend, frontend, ...hooks,
        prepare: async directory => { execFileSync('npm', ['ci', '--omit=dev'], { cwd: directory, stdio: 'inherit' }); },
      });
      console.log(JSON.stringify(result, null, 2));
    } else if (args[0] === 'rollback') {
      if (!args.includes('--previous-backend') || !args.includes('--previous-frontend')) throw new Error('Previous directories required');
      await rollbackRelease({ backend, frontend, previousBackend: get('--previous-backend'), previousFrontend: get('--previous-frontend'), ...hooks });
    } else throw new Error('Use activate or rollback');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { activateRelease, rollbackRelease } from '../../scripts/cms-release.mjs';

it('activates, rolls back failed health checks, and preserves live data on manual rollback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-release-test-'));
  try {
    const backend = path.join(root, 'backend'); const frontend = path.join(root, 'dist'); const source = path.join(root, 'release');
    await fs.mkdir(path.join(backend, 'public'), { recursive: true }); await fs.mkdir(frontend);
    await fs.writeFile(path.join(backend, 'public', 'data'), 'runtime');
    await fs.writeFile(path.join(backend, 'server.js'), 'old'); await fs.writeFile(path.join(frontend, 'index.html'), 'old');
    const files = {};
    for (const name of ['backend/server.js', 'dist/index.html']) {
      await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await fs.writeFile(path.join(source, name), 'new');
      files[name] = createHash('sha256').update('new').digest('hex');
    }
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({ commit: 'a'.repeat(40), files }));
    const hooks = { prepare: async () => {}, stop: async () => {}, start: async () => {} };
    await expect(activateRelease({ source, backend, frontend, ...hooks, check: async () => { throw new Error('unhealthy'); } })).rejects.toThrow('previous application restored');
    expect(await fs.readFile(path.join(backend, 'server.js'), 'utf8')).toBe('old');
    expect(await fs.readFile(path.join(backend, 'public', 'data'), 'utf8')).toBe('runtime');
    const result = await activateRelease({ source, backend, frontend, ...hooks, check: async () => {} });
    expect(await fs.readFile(path.join(frontend, 'index.html'), 'utf8')).toBe('new');
    await fs.writeFile(path.join(backend, 'public', 'data'), 'new live data');
    await expect(rollbackRelease({ ...result, ...hooks, check: async () => { throw new Error('old version unhealthy'); } })).rejects.toThrow('current application restored');
    expect(await fs.readFile(path.join(backend, 'public', 'data'), 'utf8')).toBe('new live data');
    expect(await fs.readFile(path.join(backend, 'server.js'), 'utf8')).toBe('new');
    const second = await activateRelease({ source, backend, frontend, ...hooks, check: async () => {} });
    await fs.writeFile(path.join(backend, 'public', 'data'), 'second release data');
    await rollbackRelease({ ...second, ...hooks, check: async () => {} });
    expect(await fs.readFile(path.join(backend, 'public', 'data'), 'utf8')).toBe('second release data');
    await rollbackRelease({ ...result, ...hooks, check: async () => {} });
    expect(await fs.readFile(path.join(backend, 'public', 'data'), 'utf8')).toBe('second release data');
    expect(await fs.readFile(path.join(backend, 'server.js'), 'utf8')).toBe('old');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

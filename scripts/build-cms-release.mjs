import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [revision, output] = process.argv.slice(2);
if (!revision || !output) throw new Error('Usage: node scripts/build-cms-release.mjs COMMIT NEW_OUTPUT_DIRECTORY');
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: repo, encoding: 'utf8' }).trim();
const target = path.resolve(output);
await fs.mkdir(target); // Refuse to overwrite an existing release.
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-release-'));
try {
  const archive = path.join(scratch, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, commit], { cwd: repo });
  execFileSync('tar', ['-xf', archive, '-C', scratch]);
  execFileSync('npm', ['ci'], { cwd: path.join(scratch, 'cms-frontend'), stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: path.join(scratch, 'cms-frontend'), stdio: 'inherit' });
  await fs.cp(path.join(scratch, 'cms-frontend', 'dist'), path.join(target, 'dist'), { recursive: true });
  await fs.cp(path.join(scratch, 'backend'), path.join(target, 'backend'), { recursive: true });
  const release = { commit, builtAt: new Date().toISOString() };
  await fs.writeFile(path.join(target, 'dist', 'release.json'), JSON.stringify(release));
  await fs.writeFile(path.join(target, 'backend', 'release.json'), JSON.stringify(release));
  const files = {};
  async function collect(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files[relative] = createHash('sha256').update(await fs.readFile(path.join(directory, entry.name))).digest('hex');
      else throw new Error(`Unsupported release entry: ${relative}`);
    }
  }
  await collect(target);
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ ...release, files }, null, 2));
  console.log(`Verified source release: ${target} (${commit})`);
} finally { await fs.rm(scratch, { recursive: true, force: true }); }

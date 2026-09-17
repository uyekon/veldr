import fs from 'node:fs/promises';
import path from 'node:path';

// Cross-process lease shared by the server, cleanup and backup tools.
// Never break an abandoned lease automatically; operator must check its owner.
export async function withCmsLock(directory, operation) {
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, '.cms-operation.lock');
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    return await operation();
  } finally { await fs.rm(lock, { recursive: true, force: true }); }
}

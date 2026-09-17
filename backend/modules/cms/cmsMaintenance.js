import { loadDB, withTransaction } from './cmsStore.js';
import { cleanupUnreferencedCmsUploads } from './cmsImages.js';

export const CMS_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export async function cleanupCmsUploads({ minAgeMs = CMS_UPLOAD_GRACE_MS } = {}) {
  return withTransaction(async () => {
  const db = await loadDB();
  const notes = [...db.notes, ...db.whiteboards, ...db.menus,
    ...db.whiteboards.flatMap(board => board.archives || [])];
  const removed = await cleanupUnreferencedCmsUploads({ notes, minAgeMs });
  return { removed, count: removed.length };
  });
}

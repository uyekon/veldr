import { loadDB } from './cmsStore.js';
import { cleanupUnreferencedCmsUploads } from './cmsImages.js';

export const CMS_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

export async function cleanupCmsUploads({ minAgeMs = CMS_UPLOAD_GRACE_MS } = {}) {
  const db = await loadDB();
  const removed = await cleanupUnreferencedCmsUploads({ notes: db.notes, minAgeMs });
  return { removed, count: removed.length };
}

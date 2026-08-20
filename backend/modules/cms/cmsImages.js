import fsp from 'fs/promises';
import path from 'path';
import { uploadDir } from './cmsStore.js';

const CMS_UPLOAD_PATTERN = /\/uploads\/cms\/([^\s)"'?#]+)/g;
const decodeFilename = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};
const safeFilename = (value) => {
  const filename = path.basename(String(value || ''));
  return filename === value && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) ? filename : null;
};

const extractCmsUploadFilenames = (content) => {
  const matches = new Set();
  const source = String(content || '');
  let match;
  while ((match = CMS_UPLOAD_PATTERN.exec(source))) {
    const filename = safeFilename(decodeFilename(match[1]));
    if (filename) matches.add(filename);
  }
  return matches;
};

const getReferencedCmsUploadFilenames = (notes = []) => {
  const referenced = new Set();
  notes.forEach((note) => {
    extractCmsUploadFilenames(note?.content).forEach((filename) => referenced.add(filename));
  });
  return referenced;
};

const removeCmsUpload = async (filename) => {
  const safe = safeFilename(filename);
  if (!safe) return false;
  try {
    await fsp.unlink(path.join(uploadDir, safe));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    return false;
  }
};

const cleanupUnreferencedCmsUploads = async ({ notes = [], candidates = null, minAgeMs = 0 } = {}) => {
  const referenced = getReferencedCmsUploadFilenames(notes);
  let filenames = candidates ? [...candidates].map(safeFilename).filter(Boolean) : [];

  if (!candidates) {
    try {
      const entries = await fsp.readdir(uploadDir, { withFileTypes: true });
      filenames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  const removed = [];
  for (const filename of new Set(filenames)) {
    if (referenced.has(filename)) continue;
    if (minAgeMs > 0) {
      try {
        const stats = await fsp.stat(path.join(uploadDir, filename));
        if (Date.now() - stats.mtimeMs < minAgeMs) continue;
      } catch {
        continue;
      }
    }
    if (await removeCmsUpload(filename)) removed.push(filename);
  }
  return removed;
};

export {
  cleanupUnreferencedCmsUploads,
  extractCmsUploadFilenames,
  getReferencedCmsUploadFilenames,
};

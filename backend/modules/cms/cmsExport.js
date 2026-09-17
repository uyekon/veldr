import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { loadDB, uploadDir, withTransaction } from './cmsStore.js';

export function noteMarkdown(note, db, content = note.content) {
  const metadata = {
    id: note.id, title: note.title,
    notebook: db.menus.find(item => item.id === note.notebookId)?.label || null,
    notebookId: note.notebookId, category: note.category,
    categoryName: db.categories.find(item => item.id === note.category)?.label || null,
    tags: note.tags || [], createdAt: note.createdAt || note.date, updatedAt: note.updatedAt || note.date,
  };
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`).join('\n')}\n---\n\n${content || ''}\n`;
}

export async function exportAllNotes() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-export-'));
  const file = path.join(temp, 'notes.zip');
  try {
    await withTransaction(async () => {
      const db = await loadDB();
      const zip = new ZipArchive({ zlib: { level: 6 } });
      const output = pipeline(zip, createWriteStream(file));
      // Consume rejection immediately; it is rethrown after finalization.
      output.catch(() => {});
      const referenced = new Set();
      const missing = [];
      const root = await fs.realpath(uploadDir);
      try {
        for (const note of db.notes) {
          const content = String(note.content || '').replace(/https?:\/\/[^\s)"'<>]+|\/uploads\/cms\/[^\s)"'<>?#]+/g, url => {
            if (!url.startsWith('/uploads/cms/')) return url;
            let name;
            try { name = decodeURIComponent(url.slice('/uploads/cms/'.length)); } catch { missing.push(url); return url; }
            if (name.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f]/.test(name)) {
              missing.push(url); return url;
            }
            referenced.add(name);
            return `attachments/${name.split('/').map(encodeURIComponent).join('/')}`;
          });
          const title = String(note.title || 'untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 70);
          zip.append(noteMarkdown(note, db, content), { name: `${note.id}-${title}.md` });
        }
        for (const name of referenced) {
          const source = path.join(uploadDir, name);
          try {
            const resolved = await fs.realpath(source);
            if (!resolved.startsWith(root + path.sep) || !(await fs.stat(resolved)).isFile()) throw new Error('Unsafe attachment');
            zip.file(resolved, { name: `attachments/${name}` });
          } catch (error) {
            if (error.code !== 'ENOENT' && error.message !== 'Unsafe attachment') throw error;
            missing.push(name);
          }
        }
        zip.append(JSON.stringify({ format: 1, exportedAt: new Date().toISOString(),
          notes: db.notes.map(({ content, ...metadata }) => metadata), categories: db.categories, notebooks: db.menus,
          missingAttachments: missing }, null, 2), { name: 'manifest.json' });
        await zip.finalize();
        await output;
      } catch (error) { zip.destroy(error); await output.catch(() => {}); throw error; }
    });
    return { file, cleanup: () => fs.rm(temp, { recursive: true, force: true }) };
  } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
}

#!/usr/bin/env node
/**
 * migrate-category-notebook-ids.mjs
 *
 * Scans the CMS db.json and supplements category.notebookId from the
 * notebookId values of notes that use each category. Rules:
 *
 *   - A note's notebook is added to its category and every ancestor.
 *   - Existing category bindings are retained (the migration never narrows).
 *   - An empty scope means global, so it remains global rather than becoming
 *     restricted to the first notebook encountered.
 *   - Set CMS_DB_PATH to migrate a production data file explicitly.
 *
 * Writes the updated db.json back to disk.  A .migrated-backup is
 * kept alongside the original file.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CMS_DB_PATH || resolve(SCRIPT_DIR, '../backend/public/data/cms/db.json');
const BACKUP_SUFFIX = '.migrated-backup';

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// 1. Build a map: categoryId → Set<notebookId>, including ancestors.
// ---------------------------------------------------------------------------
const categoryById = new Map(db.categories.map(cat => [cat.id, cat]));
const catNotebooks = new Map(db.categories.map(cat => [cat.id, new Set()]));
const ancestorIds = (categoryId) => {
  const ids = [];
  const seen = new Set();
  let id = categoryId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const category = categoryById.get(id);
    if (!category) break;
    ids.push(id);
    id = category.parentId || null;
  }
  return ids;
};
db.notes.forEach(note => {
  if (typeof note.notebookId !== 'string' || !note.notebookId) return;
  ancestorIds(note.category).forEach((categoryId) => catNotebooks.get(categoryId)?.add(note.notebookId));
});

// ---------------------------------------------------------------------------
// 2. Supplement every restricted category with its complete notebook set.
// ---------------------------------------------------------------------------
// Create a timestamped backup before changing the file.
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = DB_PATH + BACKUP_SUFFIX + '-' + timestamp;
copyFileSync(DB_PATH, backupPath);
console.log(`Backup written to: ${backupPath}`);

let changed = 0;
db.categories.forEach(cat => {
  const existing = [...new Set((Array.isArray(cat.notebookId) ? cat.notebookId : [cat.notebookId])
    .map(id => String(id || '').trim())
    .filter(Boolean))];
  // [] has the established meaning of a global category. It already covers
  // every notebook, so do not turn it into a restricted scope.
  if (existing.length === 0) return;
  const notebookIds = [...new Set([...existing, ...(catNotebooks.get(cat.id) || [])])].sort();
  if (JSON.stringify(existing) !== JSON.stringify(notebookIds)) {
    cat.notebookId = notebookIds;
    changed++;
    console.log(`  bind ${cat.label} (${cat.id}) → ${notebookIds.join(', ')}`);
  }
});

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`\nUpdated ${changed} used categor${changed === 1 ? 'y' : 'ies'}.`);

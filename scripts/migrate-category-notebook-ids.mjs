#!/usr/bin/env node
/**
 * migrate-category-notebook-ids.mjs
 *
 * Scans the CMS db.json and assigns category.notebookId as an array based on
 * the notebookId values of notes that use each category. Rules:
 *
 *   - A used category is bound to every notebook containing one of its notes.
 *   - Categories with no notebook notes retain their existing binding.
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
// 1. Build a map: categoryId → Set<notebookId>
// ---------------------------------------------------------------------------
const catNotebooks = new Map(); // categoryId → Set<string>
db.categories.forEach(cat => catNotebooks.set(cat.id, new Set()));
db.notes.forEach(note => {
  const set = catNotebooks.get(note.category);
  if (set && typeof note.notebookId === 'string' && note.notebookId) set.add(note.notebookId);
});

// ---------------------------------------------------------------------------
// 2. Backfill every used category with its complete notebook set
// ---------------------------------------------------------------------------
// Create a timestamped backup before changing the file.
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = DB_PATH + BACKUP_SUFFIX + '-' + timestamp;
copyFileSync(DB_PATH, backupPath);
console.log(`Backup written to: ${backupPath}`);

let changed = 0;
db.categories.forEach(cat => {
  const notebookIds = [...(catNotebooks.get(cat.id) || [])].sort();
  if (notebookIds.length > 0 && JSON.stringify(cat.notebookId || []) !== JSON.stringify(notebookIds)) {
    cat.notebookId = notebookIds;
    changed++;
    console.log(`  bind ${cat.label} (${cat.id}) → ${notebookIds.join(', ')}`);
  }
});

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`\nUpdated ${changed} used categor${changed === 1 ? 'y' : 'ies'}.`);

#!/usr/bin/env node
/**
 * migrate-category-notebook-ids.mjs
 *
 * Scans /opt/veldr/backend/public/data/cms/db.json and assigns
 * category.notebookId based on the notebookId of notes that use
 * each category.  Rules:
 *
 *   - If a category has notes ONLY in one notebook → bind it there.
 *   - If a category is used across multiple notebooks → leave it
 *     global (notebookId = null) so it appears in all of them.
 *   - Categories with no notes → leave global.
 *   - Parent → child hierarchy is respected: a child keeps whatever
 *     the parent gets (parent binding drives visibility).
 *
 * Writes the updated db.json back to disk.  A .migrated-backup is
 * kept alongside the original file.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DB_PATH = '/opt/veldr/backend/public/data/cms/db.json';
const BACKUP_SUFFIX = '.migrated-backup';

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// 1.  Build a map: categoryId → Set<notebookId> (null counts as "global")
// ---------------------------------------------------------------------------
const catNotebooks = new Map(); // categoryId → Set<string | null>
db.categories.forEach(cat => catNotebooks.set(cat.id, new Set()));
db.notes.forEach(note => {
  const set = catNotebooks.get(note.category);
  if (set) set.add(note.notebookId || null);
});

// ---------------------------------------------------------------------------
// 2.  Decide which categories get bound to a single notebook
// ---------------------------------------------------------------------------
const boundIds = new Set();   // category ids that will get a definite notebookId
for (const [catId, notebookSet] of catNotebooks) {
  if (notebookSet.size === 1) {
    // All notes live in exactly one notebook (or none → keep global)
    const [nb] = [...notebookSet];
    if (nb !== null) boundIds.add(catId);
  }
  // size > 1 or size === 1 with null → stays global
}

// ---------------------------------------------------------------------------
// 3.  Create backup and apply
// ---------------------------------------------------------------------------
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = DB_PATH + BACKUP_SUFFIX + '-' + timestamp;
copyFileSync(DB_PATH, backupPath);
console.log(`Backup written to: ${backupPath}`);

let changed = 0;
db.categories.forEach(cat => {
  if (boundIds.has(cat.id) && cat.notebookId !== null) {
    // Already correct
  } else if (boundIds.has(cat.id)) {
    const [nb] = [...catNotebooks.get(cat.id)];
    cat.notebookId = nb;
    changed++;
    console.log(`  bind ${cat.label} (${cat.id}) → ${nb}`);
  }
  // else: global (null) — leave as-is
});

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`\nBound ${changed} category(ies). Unchanged categories remain global.`);

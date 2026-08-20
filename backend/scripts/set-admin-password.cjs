const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const password = process.argv[2];
const dbPath = process.argv[3] || 'public/data/security.sqlite';

if (!password) {
  console.error('Usage: node scripts/set-admin-password.cjs <password> [security-db-path]');
  process.exit(1);
}

if (password.length < 8 || password.length > 128) {
  console.error('Admin password must contain 8 to 128 characters.');
  process.exit(1);
}

const db = new Database(dbPath);
const hash = bcrypt.hashSync(password, 12);
const now = new Date().toISOString();
const columns = db.prepare('pragma table_info(passwords)').all();
if (!columns.some((column) => column.name === 'sessionVersion')) {
  db.exec('alter table passwords add column sessionVersion INTEGER NOT NULL DEFAULT 1');
}
const existing = db.prepare('select id from passwords where type = ?').get('default');

if (existing) {
  db.prepare(
    'update passwords set password = ?, isDefault = 0, lastModified = ?, updatedAt = ?, sessionVersion = coalesce(sessionVersion, 1) + 1 where type = ?'
  ).run(hash, now, now, 'default');
} else {
  db.prepare(
    'insert into passwords (type, password, isDefault, lastModified, sessionVersion, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('default', hash, 0, now, 1, now, now);
}

db.close();
console.log('Admin password reset successfully.');

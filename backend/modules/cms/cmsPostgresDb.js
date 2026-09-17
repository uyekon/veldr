import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../../config/index.js';

const { Pool } = pg;
pg.types.setTypeParser(20, (value) => Number(value));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pool;

const assertPostgresConfig = () => {
  if (!config.cms.databaseUrl) {
    throw new Error('CMS_DATABASE_URL is required when CMS_STORE=postgres');
  }
};

const getCmsPool = () => {
  if (!pool) {
    assertPostgresConfig();
    pool = new Pool({
      connectionString: config.cms.databaseUrl,
      max: config.cms.databasePoolMax,
      ssl: config.cms.databaseSsl ? { rejectUnauthorized: true } : false,
      application_name: 'veldr-cms',
    });
    pool.on('error', (error) => console.error('CMS PostgreSQL pool error:', error));
  }
  return pool;
};

const runCmsMigrations = async () => {
  const client = await getCmsPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [87421031]);
    await client.query(`CREATE TABLE IF NOT EXISTS cms_schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query('SELECT version FROM cms_schema_migrations');
    const versions = new Set(applied.rows.map((row) => Number(row.version)));
    for (const [version, filename] of [[1, '001_initial.sql'], [2, '002_attachments.sql']]) {
      if (versions.has(version)) continue;
      const sql = await fs.readFile(path.join(__dirname, `postgres/${filename}`), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO cms_schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const ensureCmsOwner = async (client = getCmsPool()) => {
  await client.query(`
    INSERT INTO cms_users(id, username, role)
    VALUES ($1, $2, 'editor')
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, updated_at = now()
  `, [config.cms.ownerId, config.auth.adminUsername]);
};

const closeCmsPool = async () => {
  if (pool) await pool.end();
  pool = undefined;
};

export { getCmsPool, runCmsMigrations, ensureCmsOwner, closeCmsPool };

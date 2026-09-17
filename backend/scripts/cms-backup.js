import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dbFile, uploadDir } from '../modules/cms/cmsStore.js';
import { createBackup, verifyBackup, pruneBackups, restoreBackup } from '../modules/cms/cmsBackup.js';

const args = process.argv.slice(2);
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const backupDir = path.resolve(option('--backup-dir') || process.env.CMS_BACKUP_DIR || 'var/backups/cms');
try {
  let result;
  switch (args[0]) {
    case 'backup':
      result = await createBackup({ dbFile, uploadDir, backupDir, kind: option('--kind') || 'manual' });
      await pruneBackups(backupDir);
      break;
    case 'verify':
      if (!option('--source')) throw new Error('--source is required');
      result = (await verifyBackup(path.resolve(option('--source')))).manifest;
      break;
    case 'restore': {
      if (!option('--source') || !option('--db-file') || !option('--upload-dir')) throw new Error('Explicit --source, --db-file and --upload-dir required');
      const apply = args.includes('--apply');
      if (apply) {
        if (option('--confirm') !== 'REPLACE_CMS_DATA' || !args.includes('--service-stopped')) throw new Error('Stop backend/cleanup first; --service-stopped --confirm REPLACE_CMS_DATA required');
        const status = execFileSync('systemctl', ['show', option('--service') || 'veldr-backend', '-p', 'ActiveState', '--value'], { encoding: 'utf8' }).trim();
        if (!['inactive', 'failed'].includes(status)) throw new Error('Backend must be stopped');
      }
      result = await restoreBackup({ source: path.resolve(option('--source')), dbFile: path.resolve(option('--db-file')), uploadDir: path.resolve(option('--upload-dir')), backupDir, apply });
      break;
    }
    default: throw new Error('Usage: cms-backup.js backup|verify|restore [--source PATH] [--kind daily|manual|release] [--backup-dir PATH]. Restore is dry-run unless --apply is specified.');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }

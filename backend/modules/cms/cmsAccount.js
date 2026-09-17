import { config } from '../../config/index.js';
import { getCmsPool } from './cmsPostgresDb.js';

const syncCmsOwnerCredential = async (passwordRecord, { force = false } = {}) => {
  if (config.cms.store !== 'postgres' && !force) return;
  await getCmsPool().query(`UPDATE cms_users SET password_hash=$2,session_version=$3,updated_at=now()
    WHERE id=$1`, [config.cms.ownerId, passwordRecord?.password || null, Number(passwordRecord?.sessionVersion || 1)]);
};

export { syncCmsOwnerCredential };

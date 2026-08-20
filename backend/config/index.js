import dotenv from 'dotenv';

dotenv.config();

const env = (key, fallback) => process.env[key] ?? fallback;
const nodeEnv = env('NODE_ENV', 'development');
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? null : 'veldr-dev-secret-change-me');
const listEnv = (key, fallback) => env(key, fallback)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!jwtSecret) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  nodeEnv,
  port: Number(env('PORT', 5000)),
  db: {
    dialect: env('DB_DIALECT', 'sqlite'),
    storage: env('DB_STORAGE', 'public/data/cms.sqlite'),
    securityStorage: env('SECURITY_DB_STORAGE', 'public/data/security.sqlite'),
    logging: env('DB_LOGGING', 'false') === 'true',
  },
  uploadDir: env('UPLOAD_DIR', 'public/uploads'),
  tempDir: env('TEMP_DIR', 'temp'),
  cors: {
    origin: listEnv('CORS_ORIGIN', 'http://localhost:5173,http://localhost:5174'),
  },
  auth: {
    jwtSecret,
    adminUsername: env('ADMIN_USERNAME', 'admin'),
    jwtExpiresIn: env('JWT_EXPIRES_IN', '60d'),
    cookieName: env('AUTH_COOKIE_NAME', 'veldr_auth'),
    cookieMaxAgeMs: Number(env('AUTH_COOKIE_MAX_AGE_MS', String(60 * 24 * 60 * 60 * 1000))),
    // Secure Cookie 只在 HTTPS 下会被浏览器保存；站点还在纯 HTTP 时必须显式设为 false，
    // 否则登录后 Cookie 被浏览器丢弃，所有写操作 401/403
    cookieSecure: env('AUTH_COOKIE_SECURE', nodeEnv === 'production' ? 'true' : 'false') === 'true',
  },
  cms: {
    dataDir: env('CMS_DATA_DIR', 'public/data/cms'),
    dbFile: env('CMS_DB_FILE', 'db.json'),
    uploadDir: env('CMS_UPLOAD_DIR', 'public/uploads/cms'),
  },
};

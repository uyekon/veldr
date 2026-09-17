import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import methodOverride from 'method-override';
import { sequelize } from './config/databases.js';
import apiRoutes from './routes/index.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { cmsUploads } from './modules/cms/cmsUploads.js';
import { getCmsPool } from './modules/cms/cmsPostgresDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
const app = express();
const PORT = config.port;

// Behind nginx in production: needed for correct client IPs (rate limiting)
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(helmet({
  // API serves cross-origin frontends; images are embedded from other origins
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '20mb' })); // 增加JSON限制以支持更大的请求
app.use(express.urlencoded({ extended: true, limit: '20mb' })); // 增加URL编码限制
app.use(methodOverride('_method'));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev', {
  skip: (req) => req.path === '/api/health',
}));
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(cookieParser());

// Static folders — uploaded filenames are unique, so long immutable caching is safe
const staticCacheOptions = { maxAge: '30d', immutable: true };
app.use('/uploads/cms', cmsUploads);
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), staticCacheOptions));

// API Routes
app.use('/api', apiRoutes);


// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    if (config.cms.store === 'postgres') await getCmsPool().query('SELECT 1');
    res.status(200).json({ status: 'ok', cmsStore: config.cms.store, timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', cmsStore: config.cms.store, timestamp: new Date().toISOString() });
  }
});

// Error handling middleware (should be last)
import { errorHandler, notFound } from './middleware/errorHandler.js';
app.use(notFound);
app.use(errorHandler);

export { app, PORT };

// This file is the main Express application setup and configuration.

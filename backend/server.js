import { app, PORT } from './app.js';
import { testConnections, syncDatabases, closeConnections } from './config/databases.js';
import { initPasswordOnly } from './scripts/initPassword.js';
import { config } from './config/index.js';
import { closeCmsPool, runCmsMigrations } from './modules/cms/cmsPostgresDb.js';

let server = null;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

// Databases must be ready before the server accepts requests
const startServer = async () => {
  try {
    const connected = await testConnections();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    const synced = await syncDatabases();
    if (!synced) {
      throw new Error('Database sync failed');
    }

    // Initialize password table (只初始化，不重复连接数据库)
    await initPasswordOnly();

    if (config.cms.store === 'postgres') {
      await runCmsMigrations();
      console.log('✅ CMS PostgreSQL migrations complete');
    }

    server = app.listen(PORT, HOST, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`API URL: http://${HOST}:${PORT}/api`);
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
};

const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully`);
  if (!server) process.exit(0);
  server.close(async () => {
    await closeConnections();
    await closeCmsPool();
    console.log('Process terminated');
    process.exit(0);
  });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// Handle process termination
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
startServer();

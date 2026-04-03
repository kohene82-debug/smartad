require('dotenv').config();

const http = require('http');
const app  = require('./app');
const { initWebSocket } = require('./sockets/wsServer');
const { healthCheck }   = require('./utils/db');
const { getRedis }      = require('./utils/redis');
const logger            = require('./utils/logger');

const PORT = parseInt(process.env.PORT || '3000');

const server = http.createServer(app);

// Attach WebSocket server
initWebSocket(server);

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack:  reason instanceof Error ? reason.stack  : undefined,
    promise: String(promise),
  });
  // Treat unhandled rejections as fatal so the crash is visible
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — process will exit', {
    error: err.message,
    stack: err.stack,
    name:  err.name,
  });
  process.exit(1);
});

// Startup checks
const start = async () => {
  try {
    // DB check
    await healthCheck();
    logger.info('✅ PostgreSQL connected');

    // Redis check (non-fatal)
    try {
      await getRedis().ping();
      logger.info('✅ Redis connected');
    } catch (err) {
      logger.warn('⚠️  Redis unavailable — rate limiting will use memory store', { error: err.message });
    }

    server.on('error', (err) => {
      logger.error('HTTP server error', {
        error: err.message,
        stack: err.stack,
        code:  err.code,
      });
    });

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Smart Ad+ backend running`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        wsEndpoint: `ws://localhost:${PORT}/ws`,
      });
    });
  } catch (err) {
    logger.error('❌ Startup failed', {
      error: err.message,
      stack: err.stack,
      name:  err.name,
    });
    process.exit(1);
  }
};

start();

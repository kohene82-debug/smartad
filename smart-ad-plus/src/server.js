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

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message });
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

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Smart Ad+ backend running`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        wsEndpoint: `ws://localhost:${PORT}/ws`,
      });
    });
  } catch (err) {
    logger.error('❌ Startup failed', { error: err.message });
    process.exit(1);
  }
};

start();

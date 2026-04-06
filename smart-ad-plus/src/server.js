// ─── SAFE REQUIRE ─────────────────────────────────────────────────────────────
// Wrap every top-level require so a missing/broken module is logged immediately
// rather than crashing silently before any error handlers are registered.

let http, app, initWebSocket, healthCheck, getRedis, logger;

try {
  http = require('http');
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "http"', error: e.message, stack: e.stack }));
  process.exit(1);
}

try {
  require('dotenv').config();
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to load dotenv', error: e.message }));
  // non-fatal — continue without .env
}

try {
  app = require('./app');
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "./app"', error: e.message, stack: e.stack }));
  process.exit(1);
}

try {
  ({ initWebSocket } = require('./sockets/wsServer'));
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "./sockets/wsServer"', error: e.message, stack: e.stack }));
  process.exit(1);
}

try {
  ({ healthCheck } = require('./utils/db'));
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "./utils/db"', error: e.message, stack: e.stack }));
  process.exit(1);
}

try {
  ({ getRedis } = require('./utils/redis'));
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "./utils/redis"', error: e.message, stack: e.stack }));
  process.exit(1);
}

try {
  logger = require('./utils/logger');
} catch (e) {
  console.error(JSON.stringify({ level: 'error', message: 'Failed to require "./utils/logger"', error: e.message, stack: e.stack }));
  process.exit(1);
}

// ─── PROCESS-LEVEL DIAGNOSTICS ────────────────────────────────────────────────

process.on('exit', (code) => {
  // Synchronous — use console directly since the event loop is draining
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: '🛑 Process exiting',
    exitCode: code,
  }));
});

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

// ─── SERVER SETUP ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);

logger.info('⚙️  Creating HTTP server…');
const server = http.createServer(app);

// Attach WebSocket server
logger.info('⚙️  Initializing WebSocket server…');
try {
  initWebSocket(server);
  logger.info('⚙️  WebSocket server attached');
} catch (e) {
  logger.error('Failed to initialize WebSocket server', { error: e.message, stack: e.stack });
  process.exit(1);
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

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

// ─── STARTUP ──────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    logger.info('⚙️  Starting Smart Ad+ backend…', {
      node: process.version,
      env: process.env.NODE_ENV || 'development',
      port: PORT,
      pid: process.pid,
    });

    // ── PostgreSQL ──────────────────────────────────────────────────────────
    logger.info('⚙️  Checking PostgreSQL connection…');
    try {
      await healthCheck();
      logger.info('✅ PostgreSQL connected');
    } catch (err) {
      logger.error('❌ PostgreSQL connection failed', {
        error: err.message,
        stack: err.stack,
        hint: 'Check DATABASE_URL environment variable',
      });
      process.exit(1);
    }

    // ── Redis ───────────────────────────────────────────────────────────────
    logger.info('⚙️  Checking Redis connection…');
    try {
      await getRedis().ping();
      logger.info('✅ Redis connected');
    } catch (err) {
      logger.warn('⚠️  Redis unavailable — rate limiting will use memory store', { error: err.message });
    }

    // ── HTTP server error handler ───────────────────────────────────────────
    server.on('error', (err) => {
      logger.error('HTTP server error', {
        error: err.message,
        stack: err.stack,
        code:  err.code,
      });
    });

    // ── Bind ────────────────────────────────────────────────────────────────
    logger.info(`⚙️  Binding to 0.0.0.0:${PORT}…`);
    await new Promise((resolve, reject) => {
      server.listen(PORT, '0.0.0.0', () => resolve());
      server.once('error', reject);
    });

    logger.info('🚀 Smart Ad+ backend running', {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      wsEndpoint: `ws://localhost:${PORT}/ws`,
      pid: process.pid,
    });

    // ── Post-startup delay to confirm stability ─────────────────────────────
    // Give the event loop a full tick to surface any deferred errors that
    // occur immediately after binding (e.g. background timers, lazy requires).
    await new Promise((resolve) => setTimeout(resolve, 500));
    logger.info('✅ Initialization complete — server is stable and accepting requests');

    // ── No-traffic watchdog ─────────────────────────────────────────────────
    // If the process is still alive but no request has arrived within 30 s,
    // log a diagnostic to help distinguish "crashed" from "running but not
    // reachable" (e.g. port binding or proxy misconfiguration).
    let requestReceived = false;
    server.on('request', () => { requestReceived = true; });

    setTimeout(() => {
      if (!requestReceived) {
        logger.warn('⚠️  No HTTP requests received in the first 30 seconds', {
          hint: 'The server is running but has not been reached. Check that PORT is correctly exposed and the proxy/load-balancer is routing traffic to this process.',
          port: PORT,
          pid: process.pid,
        });
      }
    }, 30000);

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


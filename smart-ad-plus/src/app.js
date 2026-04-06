require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const compression = require('compression');
const { globalLimiter } = require('./middlewares/rateLimiter');
const response   = require('./utils/response');
const logger     = require('./utils/logger');

// Routes
const authRoutes       = require('./routes/auth');
const adsRoutes        = require('./routes/ads');
const userRoutes       = require('./routes/users');
const advertiserRoutes = require('./routes/advertiser');
const adminRoutes      = require('./routes/admin');

const app = express();

// Trust Railway's reverse proxy so Express reads the real client IP
// from the X-Forwarded-For header, which is required for rate limiting.
app.set('trust proxy', 1);

// ─── SECURITY ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      objectSrc:  ["'none'"],
    },
  },
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS not allowed'));
    }
  },
  credentials: true,
}));

// ─── BODY / COMPRESSION ───────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── LOGGING ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

// ─── GLOBAL RATE LIMIT ────────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── PING (smoke-test — no auth, no DB, no Redis) ─────────────────────────────
app.get('/ping', (req, res) => {
  res.send('pong');
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const { healthCheck } = require('./utils/db');
    await healthCheck();
    return res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
  } catch (err) {
    return res.status(503).json({ status: 'error', message: err.message });
  }
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/ads',        adsRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/advertiser', advertiserRoutes);
app.use('/api/admin',      adminRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  response.notFound(res, `Route ${req.method} ${req.path} not found`);
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  if (err.message === 'CORS not allowed') {
    return response.error(res, 'CORS policy violation', 403);
  }
  return response.serverError(res, 'An unexpected error occurred');
});

module.exports = app;

const Redis = require('ioredis');
const logger = require('./logger');

let redis;

const getRedis = () => {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error('Redis retry limit exceeded — giving up', { attempts: times });
          return null; // stop retrying; ioredis will emit an error event
        }
        const delay = Math.min(times * 100, 3000);
        logger.warn('Redis reconnecting', { attempt: times, delayMs: delay });
        return delay;
      },
    });

    redis.on('connect', () => logger.info('✅ Redis connected'));
    redis.on('ready',   () => logger.info('Redis client ready'));
    redis.on('error',   (err) => logger.error('Redis client error', {
      error: err.message,
      stack: err.stack,
      code:  err.code,
    }));
    redis.on('close',        () => logger.warn('Redis connection closed'));
    redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));
    redis.on('end',          () => logger.error('Redis connection ended — no more reconnects will be attempted'));
  }
  return redis;
};

// Convenience wrappers
const set = (key, value, ttlSeconds) => {
  const r = getRedis();
  if (ttlSeconds) return r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return r.set(key, JSON.stringify(value));
};

const get = async (key) => {
  const val = await getRedis().get(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
};

const del = (key) => getRedis().del(key);

const incr = (key) => getRedis().incr(key);

const expire = (key, seconds) => getRedis().expire(key, seconds);

const exists = (key) => getRedis().exists(key);

module.exports = { getRedis, set, get, del, incr, expire, exists };

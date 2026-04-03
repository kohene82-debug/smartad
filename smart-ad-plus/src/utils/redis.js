const Redis = require('ioredis');

let redis;

const getRedis = () => {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 10) return null;
        return Math.min(times * 100, 3000);
      },
    });

    redis.on('connect', () => console.log('✅ Redis connected'));
    redis.on('error', (err) => console.error('❌ Redis error:', err.message));
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

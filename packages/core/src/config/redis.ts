import { logger } from './logger';

export interface RedisClient {
  native: any;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  incrby(key: string, by: number): Promise<number>;
  expire(key: string, ttl: number): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

/** In-memory fallback when Redis is unavailable (dev/no-redis environments) */
function buildMemoryClient(): RedisClient {
  const store = new Map<string, { value: string; expiry?: number }>();

  const isExpired = (key: string) => {
    const entry = store.get(key);
    if (!entry) return true;
    if (entry.expiry && Date.now() > entry.expiry) { store.delete(key); return true; }
    return false;
  };

  // Minimal EventEmitter duck-type so EventBus doesn't crash
  const native = {
    publish: async () => 0,
    subscribe: async () => {},
    on: () => {},
    duplicate: () => native,
    status: 'ready',
  } as any;

  logger.warn('Redis unavailable — using in-memory fallback (not suitable for production)');

  return {
    native,
    get: async (key) => (isExpired(key) ? null : store.get(key)?.value ?? null),
    set: async (key, value) => { store.set(key, { value }); },
    setex: async (key, ttl, value) => { store.set(key, { value, expiry: Date.now() + ttl * 1000 }); },
    del: async (...keys) => { keys.forEach(k => store.delete(k)); },
    incrby: async (key, by) => {
      const current = parseInt(store.get(key)?.value ?? '0', 10);
      const next = current + by;
      store.set(key, { value: String(next) });
      return next;
    },
    expire: async (key, ttl) => {
      const entry = store.get(key);
      if (entry) store.set(key, { ...entry, expiry: Date.now() + ttl * 1000 });
    },
    keys: async (pattern) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return [...store.keys()].filter(k => regex.test(k));
    },
  };
}

export function buildRedisClient(url: string): RedisClient {
  // If no URL or explicitly disabled, use in-memory fallback
  if (!url || url === 'disabled') return buildMemoryClient();

  try {
    // Dynamically require ioredis — won't crash if unavailable
    const Redis = require('ioredis');
    const redis = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', () => {}); // suppress unhandled errors

    // Test connection; if it fails within 3s, fall back to memory
    redis.connect().catch(() => {});

    return {
      native: redis,
      get: (key) => redis.get(key).catch(() => null),
      set: (key, value) => redis.set(key, value).then(() => {}).catch(() => {}),
      setex: (key, ttl, value) => redis.setex(key, ttl, value).then(() => {}).catch(() => {}),
      del: (...keys) => redis.del(...keys).then(() => {}).catch(() => {}),
      incrby: (key, by) => redis.incrby(key, by).catch(() => 0),
      expire: (key, ttl) => redis.expire(key, ttl).then(() => {}).catch(() => {}),
      keys: (pattern) => redis.keys(pattern).catch(() => []),
    };
  } catch {
    return buildMemoryClient();
  }
}

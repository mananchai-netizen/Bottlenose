import { Redis } from 'ioredis';
import { redisOptionsFromUrl } from './redis-options';

export type RedisClearMode = 'registry' | 'locks' | 'all';

export interface RedisClearResult {
  registryRemoved?: number;
  hanLocksRemoved?: number;
  legacyTaskLocksRemoved?: number;
}

export function isRedisClearMode(value: unknown): value is RedisClearMode {
  return value === 'registry' || value === 'locks' || value === 'all';
}

async function deleteByPattern(redis: Redis, pattern: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = nextCursor;
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== '0');

  return deleted;
}

export async function clearHanRedisCache(redisUrl: string, mode: RedisClearMode): Promise<RedisClearResult> {
  const redis = new Redis(redisOptionsFromUrl(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  }));

  try {
    await redis.connect();
    const result: RedisClearResult = {};

    if (mode === 'registry' || mode === 'all') {
      result.registryRemoved = await redis.del('han:registry');
    }

    if (mode === 'locks' || mode === 'all') {
      result.hanLocksRemoved = await deleteByPattern(redis, 'han:lock:*');
      result.legacyTaskLocksRemoved = await deleteByPattern(redis, 'task:*:lock');
    }

    return result;
  } finally {
    redis.disconnect();
  }
}

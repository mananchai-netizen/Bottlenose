import type { RedisOptions } from 'ioredis';

export function redisOptionsFromUrl(redisUrl: string, overrides: RedisOptions = {}): RedisOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  const options: RedisOptions = {
    host: url.hostname,
    ...overrides,
  };

  if (url.port.length > 0) options.port = Number(url.port);
  if (url.username.length > 0) options.username = decodeURIComponent(url.username);
  if (url.password.length > 0) options.password = decodeURIComponent(url.password);
  if (db !== undefined && Number.isFinite(db)) options.db = db;
  if (url.protocol === 'rediss:') options.tls = {};

  return options;
}

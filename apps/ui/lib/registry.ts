import { Redis } from 'ioredis';
import type { MachineConfig, MachineInfo } from './types';
import { redisOptionsFromUrl } from './redis-options';

const REGISTRY_KEY = 'han:registry';
const OFFLINE_THRESHOLD_MS = 120_000;
const CONFIGURED_MACHINE_ACTIVITY = 'Configured worker waiting for a webhook trigger';

export async function getMachines(config: MachineConfig): Promise<MachineInfo[]> {
  await ensureConfiguredMachine(config);
  return getRegisteredMachines(config.redis_url);
}

async function getRegisteredMachines(redisUrl: string): Promise<MachineInfo[]> {
  const redis = new Redis(redisOptionsFromUrl(redisUrl, { lazyConnect: true, enableOfflineQueue: false }));
  try {
    await redis.connect();
    const all = await redis.hgetall(REGISTRY_KEY);
    const now = Date.now();
    return Object.values(all).map((raw) => {
      const info = JSON.parse(raw) as MachineInfo;
      info.status = now - info.last_seen > OFFLINE_THRESHOLD_MS ? 'offline' : 'online';
      return info;
    });
  } catch {
    return [];
  } finally {
    redis.disconnect();
  }
}

async function ensureConfiguredMachine(config: MachineConfig): Promise<void> {
  const redis = new Redis(redisOptionsFromUrl(config.redis_url, { lazyConnect: true, enableOfflineQueue: false }));
  try {
    await redis.connect();
    await redis.hsetnx(REGISTRY_KEY, config.machine_id, JSON.stringify(createConfiguredMachine(config)));
  } catch {
    // The runtime registry already tolerates Redis being unavailable for status reads.
  } finally {
    redis.disconnect();
  }
}

function createConfiguredMachine(config: MachineConfig): MachineInfo {
  return {
    machine_id: config.machine_id,
    machine_name: config.machine_name,
    status: 'offline',
    last_seen: 0,
    accept_types: config.accept_types,
    activity_status: 'waiting',
    activity_message: CONFIGURED_MACHINE_ACTIVITY,
  };
}

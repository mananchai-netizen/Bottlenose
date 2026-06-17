import { Redis as IORedis } from 'ioredis';
import { redisOptionsFromUrl } from './redis-options.js';

const LOCK_TTL_MS = 300_000; // 5 นาที
const HEARTBEAT_INTERVAL_MS = 30_000;

export class RedisLock {
  private redis: IORedis;
  private machineId: string;
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(redisUrl: string, machineId: string) {
    this.redis = new IORedis(redisOptionsFromUrl(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null }));
    this.machineId = machineId;
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    this.heartbeatTimers.forEach((t) => clearInterval(t));
    await this.redis.quit();
  }

  /** Atomic claim via SETNX — returns true ถ้า claim สำเร็จ */
  async claim(taskId: string): Promise<boolean> {
    const key = `han:lock:${taskId}`;
    const result = await this.redis.set(key, this.machineId, 'PX', LOCK_TTL_MS, 'NX');
    if (result === 'OK') {
      this.startHeartbeat(taskId);
      return true;
    }
    return false;
  }

  /** Release lock เมื่อทำงานเสร็จหรือ fail */
  async release(taskId: string): Promise<void> {
    this.stopHeartbeat(taskId);
    const key = `han:lock:${taskId}`;
    const owner = await this.redis.get(key);
    if (owner === this.machineId) {
      await this.redis.del(key);
    }
  }

  /** Heartbeat — ต่ออายุ lock ทุก 30s กันไม่ให้ timeout ก่อนเสร็จ */
  private startHeartbeat(taskId: string): void {
    const timer = setInterval(async () => {
      const key = `han:lock:${taskId}`;
      const owner = await this.redis.get(key);
      if (owner === this.machineId) {
        await this.redis.pexpire(key, LOCK_TTL_MS);
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimers.set(taskId, timer);
  }

  private stopHeartbeat(taskId: string): void {
    const timer = this.heartbeatTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(taskId);
    }
  }

  getRedis(): IORedis {
    return this.redis;
  }
}

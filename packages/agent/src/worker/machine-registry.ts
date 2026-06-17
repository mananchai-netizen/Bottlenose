import type { Redis as IORedis } from 'ioredis';
import type { MachineInfo, TaskType } from '../types.js';

const REGISTRY_KEY = 'han:registry';
const HEARTBEAT_INTERVAL_MS = 30_000;
const OFFLINE_THRESHOLD_MS = 120_000; // 2 นาที

export class MachineRegistry {
  private readonly redis: IORedis;
  private readonly machineId: string;
  private machineName: string;
  private acceptTypes: TaskType[];
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(redis: IORedis, machineId: string, machineName: string, acceptTypes: TaskType[]) {
    this.redis = redis;
    this.machineId = machineId;
    this.machineName = machineName;
    this.acceptTypes = acceptTypes;
  }

  /** Register เครื่องนี้เข้า registry และเริ่ม heartbeat ทุก 30s */
  async register(): Promise<void> {
    await this.ping();
    this.heartbeatTimer = setInterval(() => void this.ping(), HEARTBEAT_INTERVAL_MS);
  }

  async unregister(): Promise<void> {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    const info: MachineInfo = {
      machine_id: this.machineId,
      machine_name: this.machineName,
      status: 'offline',
      last_seen: Date.now(),
      accept_types: this.acceptTypes,
    };
    await this.redis.hset(REGISTRY_KEY, this.machineId, JSON.stringify(info));
  }

  async update(machineName: string, acceptTypes: TaskType[]): Promise<void> {
    this.machineName = machineName;
    this.acceptTypes = acceptTypes;
    await this.ping();
  }

  /** อัปเดต task ที่กำลังทำอยู่ (undefined = ว่าง) */
  async setCurrentTask(taskId: string | undefined): Promise<void> {
    const raw = await this.redis.hget(REGISTRY_KEY, this.machineId);
    if (raw === null) return;
    const info = JSON.parse(raw) as MachineInfo;
    if (taskId !== undefined) {
      info.current_task = taskId;
    } else {
      delete info.current_task;
    }
    await this.redis.hset(REGISTRY_KEY, this.machineId, JSON.stringify(info));
  }

  async setActivity(status: string, message: string): Promise<void> {
    const raw = await this.redis.hget(REGISTRY_KEY, this.machineId);
    if (raw === null) return;
    const info = JSON.parse(raw) as MachineInfo;
    info.activity_status = status;
    info.activity_message = message;
    info.activity_updated_at = Date.now();
    await this.redis.hset(REGISTRY_KEY, this.machineId, JSON.stringify(info));
  }

  /** ดูรายชื่อ machine ทั้งหมด (ตรวจ online/offline จาก last_seen) */
  async listAll(): Promise<MachineInfo[]> {
    const all = await this.redis.hgetall(REGISTRY_KEY);
    const now = Date.now();
    return Object.values(all).map((raw) => {
      const info = JSON.parse(raw) as MachineInfo;
      info.status = now - info.last_seen > OFFLINE_THRESHOLD_MS ? 'offline' : 'online';
      return info;
    });
  }

  private async ping(): Promise<void> {
    const raw = await this.redis.hget(REGISTRY_KEY, this.machineId);
    const existing = raw !== null ? (JSON.parse(raw) as MachineInfo) : undefined;
    const info: MachineInfo = {
      machine_id: this.machineId,
      machine_name: this.machineName,
      status: 'online',
      last_seen: Date.now(),
      accept_types: this.acceptTypes,
    };
    if (existing?.current_task !== undefined) {
      info.current_task = existing.current_task;
    }
    if (existing?.activity_status !== undefined) {
      info.activity_status = existing.activity_status;
    }
    if (existing?.activity_message !== undefined) {
      info.activity_message = existing.activity_message;
    }
    if (existing?.activity_updated_at !== undefined) {
      info.activity_updated_at = existing.activity_updated_at;
    }
    await this.redis.hset(REGISTRY_KEY, this.machineId, JSON.stringify(info));
  }
}

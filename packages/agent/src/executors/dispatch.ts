import type { HanTask, MachineConfig, ExecutorTarget } from '../types.js';

/**
 * ทุก task รันบน Vercel — RunPod ใช้สำหรับ Qwen3.7-Max LLM inference เท่านั้น
 */
export function resolveExecutorTarget(_task: HanTask, _config: MachineConfig): ExecutorTarget {
  return 'vercel';
}

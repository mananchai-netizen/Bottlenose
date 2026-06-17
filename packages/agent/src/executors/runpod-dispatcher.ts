import type { HanTask, ProjectConfig } from '../types.js';

const RUNPOD_API_BASE = 'https://api.runpod.ai/v2';

export interface RunPodJobInput {
  task: HanTask;
  project: Pick<ProjectConfig, 'project_id' | 'notion_db_id' | 'github_repo' | 'google_drive_folder_id'>;
  notion_token: string;
  // brain config ที่ handler ต้องการ
  brain_name: string;
  llm_server_url?: string;
  llm_server_token?: string;
  // dev task extras
  github_token?: string;
  claude_api_key?: string;
  claude_bin?: string;
}

export interface RunPodDispatchResult {
  job_id: string;
  endpoint_id: string;
}

/**
 * ส่ง job ไป RunPod Serverless endpoint (async)
 * RunPod จะ POST ผลกลับมาที่ callbackUrl เมื่อเสร็จ
 */
export async function dispatchToRunPod(
  endpointId: string,
  apiKey: string,
  input: RunPodJobInput,
  callbackUrl: string,
): Promise<RunPodDispatchResult> {
  const res = await fetch(`${RUNPOD_API_BASE}/${endpointId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input, webhook: callbackUrl }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RunPod API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return { job_id: data.id, endpoint_id: endpointId };
}

/** ดึง status ของ job (สำหรับ polling fallback) */
export async function getRunPodJobStatus(
  endpointId: string,
  apiKey: string,
  jobId: string,
): Promise<{ status: string; output?: unknown }> {
  const res = await fetch(`${RUNPOD_API_BASE}/${endpointId}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`RunPod status error ${res.status}`);
  }

  return res.json() as Promise<{ status: string; output?: unknown }>;
}

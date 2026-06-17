import type { MachineConfig, ProjectConfig, BrainName } from './types'

export async function getMachineConfig(): Promise<MachineConfig | null> {
  const notionToken = process.env.NOTION_TOKEN ?? ''
  if (!notionToken) return null

  return {
    machine_id:           process.env.HAN_MACHINE_ID ?? 'local',
    machine_name:         process.env.HAN_MACHINE_ID ?? 'local',
    accept_types:         ['dev', 'doc', 'sheet', 'slide'],
    brain:                { default: (process.env.HAN_BRAIN ?? 'qwen-runpod') as BrainName },
    notion_token:         notionToken,
    redis_url:            process.env.REDIS_URL ?? '',
    poll_interval:        30,
    max_concurrent_tasks: 1,
    ...(process.env.GITHUB_TOKEN              ? { github_token:              process.env.GITHUB_TOKEN }              : {}),
    ...(process.env.ANTHROPIC_API_KEY         ? { claude_api_key:            process.env.ANTHROPIC_API_KEY }         : {}),
    ...(process.env.GEMINI_API_KEY            ? { gemini_api_key:            process.env.GEMINI_API_KEY }            : {}),
    ...(process.env.OPENROUTER_API_KEY        ? { openrouter_api_key:        process.env.OPENROUTER_API_KEY }        : {}),
    ...(process.env.OPENROUTER_MODEL          ? { openrouter_model:          process.env.OPENROUTER_MODEL }          : {}),
    ...(process.env.LINE_CHANNEL_ACCESS_TOKEN ? { line_channel_access_token: process.env.LINE_CHANNEL_ACCESS_TOKEN } : {}),
    ...(process.env.LINE_CHANNEL_SECRET       ? { line_channel_secret:       process.env.LINE_CHANNEL_SECRET }       : {}),
    ...(process.env.LINE_NOTIFY_TOKEN         ? { line_notify_token:         process.env.LINE_NOTIFY_TOKEN }         : {}),
    ...(process.env.QWEN_RUNPOD_URL           ? { qwen_runpod_url:           process.env.QWEN_RUNPOD_URL }           : {}),
    ...(process.env.QWEN_RUNPOD_TOKEN         ? { qwen_runpod_token:         process.env.QWEN_RUNPOD_TOKEN }         : {}),
    ...(process.env.QWEN_MODEL_NAME           ? { qwen_model_name:           process.env.QWEN_MODEL_NAME }           : {}),
  }
}

export async function saveMachineConfig(_config: MachineConfig): Promise<void> {
  // Config is sourced from .env.local — no-op at runtime
}

export async function getProjects(): Promise<ProjectConfig[]> {
  try {
    const raw = process.env.HAN_PROJECTS_JSON ?? '[]'
    return JSON.parse(raw) as ProjectConfig[]
  } catch {
    return []
  }
}

export async function saveProject(_project: ProjectConfig): Promise<void> {
  // Projects are sourced from HAN_PROJECTS_JSON in .env.local — no-op at runtime
}

export async function deleteProject(_projectId: string): Promise<void> {
  // Projects are sourced from HAN_PROJECTS_JSON in .env.local — no-op at runtime
}

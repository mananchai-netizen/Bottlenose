const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet'

// ── Infrastructure secrets — must stay in env vars ───────────────────────────
export const CRON_SECRET = (() => {
  const s = process.env.CRON_SECRET ?? ''
  if (!s) throw new Error('CRON_SECRET is not set')
  return s
})()
export const APP_URL = process.env.APP_URL ?? 'http://localhost:3100'

// ── Sync exports — env-var only ───────────────────────────────────────────────
export const NOTION_TOKEN = process.env.NOTION_TOKEN ?? ''
export const REDIS_URL = process.env.REDIS_URL ?? ''
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? ''
export const QWEN_RUNPOD_URL = process.env.QWEN_RUNPOD_URL ?? ''
export const QWEN_RUNPOD_TOKEN = process.env.QWEN_RUNPOD_TOKEN ?? ''
export const QWEN_MODEL_NAME = process.env.QWEN_MODEL_NAME ?? 'Qwen/Qwen2.5-7B-Instruct-AWQ'
export const HAN_BRAIN = process.env.HAN_BRAIN ?? 'qwen-runpod'
export const HAN_MACHINE_ID = process.env.HAN_MACHINE_ID ?? 'local'
export const GOOGLE_OAUTH_CLIENT_JSON = process.env.GOOGLE_OAUTH_CLIENT_JSON ?? ''
export const GOOGLE_OAUTH_TOKEN_PATH = process.env.GOOGLE_OAUTH_TOKEN_PATH ?? ''

export const PROJECTS: Array<{
  project_id: string
  project_name: string
  notion_db_id: string
  github_repo?: string
  google_drive_folder_id?: string
}> = (() => {
  try {
    const raw = process.env.HAN_PROJECTS_JSON ?? '[]'
    return JSON.parse(raw) as Array<{
      project_id: string
      project_name: string
      notion_db_id: string
      github_repo?: string
      google_drive_folder_id?: string
    }>
  } catch {
    return []
  }
})()

// ── Async config — reads from .env.local, 60 s cache ─────────────────────────

export interface ServerConfig {
  NOTION_TOKEN: string
  REDIS_URL: string
  GITHUB_TOKEN: string
  QWEN_RUNPOD_URL: string
  QWEN_RUNPOD_TOKEN: string
  QWEN_MODEL_NAME: string
  HAN_BRAIN: string
  HAN_MACHINE_ID: string
  APP_URL: string
  CRON_SECRET: string
  GOOGLE_OAUTH_CLIENT_JSON: string
  GOOGLE_OAUTH_TOKEN_PATH: string
  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL: string
  PROJECTS: Array<{
    project_id: string
    project_name: string
    notion_db_id: string
    github_repo?: string
    github_token?: string
    google_drive_folder_id?: string
  }>
}

let _cache: ServerConfig | null = null
let _cacheAt = 0
const TTL = 60_000

export function invalidateServerConfigCache(): void {
  _cache = null
  _cacheAt = 0
}

export async function getServerConfig(): Promise<ServerConfig> {
  const now = Date.now()
  if (_cache && now - _cacheAt < TTL) return _cache

  const cfg: ServerConfig = {
    NOTION_TOKEN:                process.env.NOTION_TOKEN               ?? '',
    REDIS_URL:                   process.env.REDIS_URL                  ?? '',
    GITHUB_TOKEN:                process.env.GITHUB_TOKEN               ?? '',
    QWEN_RUNPOD_URL:             process.env.QWEN_RUNPOD_URL            ?? '',
    QWEN_RUNPOD_TOKEN:           process.env.QWEN_RUNPOD_TOKEN          ?? '',
    QWEN_MODEL_NAME:             process.env.QWEN_MODEL_NAME            ?? 'Qwen/Qwen2.5-7B-Instruct-AWQ',
    HAN_BRAIN:                   process.env.HAN_BRAIN                  ?? 'qwen-runpod',
    HAN_MACHINE_ID:              process.env.HAN_MACHINE_ID             ?? 'local',
    APP_URL:                     process.env.APP_URL                    ?? 'http://localhost:3100',
    CRON_SECRET:                 process.env.CRON_SECRET                ?? '',
    GOOGLE_OAUTH_CLIENT_JSON:    process.env.GOOGLE_OAUTH_CLIENT_JSON    ?? '',
    GOOGLE_OAUTH_TOKEN_PATH:     process.env.GOOGLE_OAUTH_TOKEN_PATH     ?? '',
    OPENROUTER_API_KEY:          process.env.OPENROUTER_API_KEY         ?? '',
    OPENROUTER_MODEL:            process.env.OPENROUTER_MODEL           ?? DEFAULT_OPENROUTER_MODEL,
    PROJECTS,
  }

  _cache = cfg
  _cacheAt = now
  return cfg
}

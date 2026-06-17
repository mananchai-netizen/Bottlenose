export type TaskType = 'dev' | 'doc' | 'sheet' | 'slide';
export type TaskStatus = 'New' | 'Approve' | 'In-Progress' | 'Done' | 'Failed';
export type DevPublishMode = 'cli' | 'github-api';
export type ExecutorTarget = 'vercel' | 'runpod' | 'runpod-sandbox';
export type BrainName =
  | 'claude-cli'        // spawn `claude` binary — ไม่ต้องใช้ API key
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'llm-server'        // POST ไปที่ llm_server_url
  | 'claude-api-sonnet' // @anthropic-ai/sdk → claude-sonnet-4-6
  | 'claude-api-opus'   // @anthropic-ai/sdk → claude-opus-4-7
  | 'openrouter'        // OpenRouter HTTP API (OpenAI-compat)
  | 'qwen3-max';        // Qwen3.7-Max บน RunPod vLLM (OpenAI-compat)

export interface BrainConfig {
  default: BrainName;
  dev?: BrainName;
  doc?: BrainName;
  sheet?: BrainName;
  slide?: BrainName;
}

export interface MachineConfig {
  machine_id: string;
  machine_name: string;
  accept_types: TaskType[];
  brain: BrainConfig;
  notion_token: string;
  // Fallback for future config/DB storage. Multi-worker production deployments
  // should set NOTION_WEBHOOK_VERIFICATION_TOKEN per Vercel environment.
  notion_webhook_verification_token?: string;
  claude_api_key?: string;
  gemini_api_key?: string;
  discord_token?: string;
  discord_channel_id?: string;
  llm_server_url?: string;
  llm_server_token?: string;
  openrouter_api_key?: string;
  openrouter_model?: string;
  line_channel_access_token?: string;
  line_channel_secret?: string;
  line_target_id?: string;
  line_notify_token?: string;
  claude_bin?: string;
  google_key_path?: string;
  google_oauth_client_path?: string;
  google_oauth_token_path?: string;
  dev_publish_mode?: DevPublishMode;
  github_token?: string;
  redis_url: string;
  poll_interval: number;
  max_concurrent_tasks: number;
  // RunPod — regular worker (LLM inference / GPU)
  runpod_api_key?: string;
  runpod_endpoint_id?: string;
  // RunPod Sandbox — isolated dev task execution
  runpod_sandbox_endpoint_id?: string;
  runpod_callback_secret?: string;
  qwen_runpod_url?: string;
  qwen_runpod_token?: string;
}

export interface ProjectConfig {
  project_id: string;
  project_name: string;
  notion_db_id: string;
  github_repo?: string;
  google_drive_folder_id?: string;
  discord_channel_id?: string;
  brain_override?: Partial<BrainConfig>;
}

export interface HanTask {
  id: string;
  notion_page_id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  retry_count: number;
  project_id?: string;
  assigned_to?: string;
  planned_by?: string;
  planned_at?: string;
  claimed_by?: string;
  claimed_at?: string;
  heartbeat_at?: string;
  output_url?: string;
  error_log?: string;
  brain_used?: string;
  context?: string;
}

export interface MachineInfo {
  machine_id: string;
  machine_name: string;
  status: 'online' | 'offline';
  last_seen: number;
  accept_types: TaskType[];
  current_task?: string;
  activity_status?: string;
  activity_message?: string;
  activity_updated_at?: number;
}

export interface TaskUpdateExtra {
  claimed_by?: string;
  claimed_at?: string;
  heartbeat_at?: string;
  output_url?: string;
  error_log?: string | null;
  brain_used?: string;
  retry_count?: number;
}

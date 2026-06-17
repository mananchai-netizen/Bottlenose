import type { MachineConfig, TaskType, BrainName } from '../types.js';

const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
import type { Brain } from './types.js';
import { ClaudeCliBrain } from './claude-cli.js';
import { LLMServerBrain } from './llm-server.js';
import { ClaudeAPIBrain, OpenRouterBrain } from './ai-sdk.js';

/** เลือก brain ตาม task type — ดู per-type override ก่อน แล้ว fallback ไป default */
export function resolveBrain(config: MachineConfig, taskType: TaskType): Brain {
  const brainName: BrainName = config.brain[taskType] ?? config.brain.default;
  return createBrain(brainName, config);
}

function createBrain(name: BrainName, config: MachineConfig): Brain {
  const claudeBin = config.claude_bin ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');
  switch (name) {
    case 'claude-cli':
      return new ClaudeCliBrain({ model: 'sonnet', claudeBin });

    case 'claude-sonnet-4-6':
      return new ClaudeCliBrain({ model: 'claude-sonnet-4-6', claudeBin });

    case 'claude-opus-4-7':
      return new ClaudeCliBrain({ model: 'claude-opus-4-7', claudeBin });

    case 'gemini-2.5-pro':
    case 'gemini-2.0-flash':
      // Phase 3 extension point — fallback ไป claude-cli ก่อน
      return new ClaudeCliBrain({ model: 'sonnet' });

    case 'llm-server': {
      const url = config.llm_server_url;
      if (url === undefined) throw new Error('llm_server_url not configured');
      return new LLMServerBrain(url, config.llm_server_token);
    }

    case 'claude-api-sonnet': {
      const key = config.claude_api_key;
      if (key === undefined) throw new Error('claude_api_key not configured');
      return new ClaudeAPIBrain(key, 'claude-sonnet-4-6');
    }

    case 'claude-api-opus': {
      const key = config.claude_api_key;
      if (key === undefined) throw new Error('claude_api_key not configured');
      return new ClaudeAPIBrain(key, 'claude-opus-4-7');
    }

    case 'openrouter': {
      const key = config.openrouter_api_key;
      if (key === undefined) throw new Error('openrouter_api_key not configured');
      const model = config.openrouter_model ?? DEFAULT_OPENROUTER_MODEL;
      return new OpenRouterBrain(key, model);
    }

    case 'qwen3-max': {
      const url = config.qwen_runpod_url;
      if (url === undefined) throw new Error('qwen_runpod_url not configured');
      return new LLMServerBrain(url, config.qwen_runpod_token);
    }
  }
}

export type { Brain, BrainRequest, BrainResponse } from './types.js';

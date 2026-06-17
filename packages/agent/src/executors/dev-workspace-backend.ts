import type { MachineConfig } from '../types.js';
import chalk from 'chalk';
import { createGithubApiWorkspaceBackend } from './github-api-workspace-backend.js';
import {
  createWorkspace,
  commitAndPush,
  createPR,
  type Workspace,
} from './cli-workspace-backend.js';

export interface DevWorkspaceBackend {
  createWorkspace: (githubRepo: string, taskId: string) => Workspace | Promise<Workspace>;
  commitAndPush: (ws: Workspace, message: string) => boolean | Promise<boolean>;
  createPR: (ws: Workspace, title: string, body: string) => string | Promise<string>;
}

const cliWorkspaceBackend: DevWorkspaceBackend = {
  createWorkspace,
  commitAndPush,
  createPR,
};

export function resolveDevWorkspaceBackend(config: MachineConfig): DevWorkspaceBackend {
  const mode = config.dev_publish_mode ?? 'cli';
  console.log(chalk.gray(`   dev publish backend: ${mode}`));

  switch (mode) {
    case 'cli':
      return cliWorkspaceBackend;
    case 'github-api':
      return createGithubApiWorkspaceBackend(getGithubToken(config));
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown dev_publish_mode: ${String(_exhaustive)}`);
    }
  }
}

function getGithubToken(config: MachineConfig): string {
  const token = config.github_token ?? process.env.GITHUB_TOKEN;
  if (token === undefined || token.trim().length === 0) {
    throw new Error('github_token or GITHUB_TOKEN is required when dev_publish_mode is "github-api"');
  }
  return token.trim();
}

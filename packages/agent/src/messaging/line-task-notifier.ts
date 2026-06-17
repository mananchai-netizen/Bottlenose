import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';

const LINE_MESSAGING_API_BASE = 'https://api.line.me/v2/bot/message';

interface NotifyLineTaskDoneOptions {
  config: MachineConfig;
  task: HanTask;
  project: ProjectConfig;
  outputUrl?: string;
}

export interface LineTaskNotifyResult {
  sent: boolean;
  mode?: 'push' | 'broadcast';
  reason?: 'missing_token';
}

function buildTaskDoneMessage(options: NotifyLineTaskDoneOptions): string {
  const { config, task, project, outputUrl } = options;
  const lines = [
    `Task done: ${task.title}`,
    `Type: ${task.type}`,
    `Project: ${project.project_name} (${project.project_id})`,
    `Executor: ${config.machine_name} (${config.machine_id})`,
    outputUrl !== undefined ? `Output: ${outputUrl}` : undefined,
  ];

  return lines.filter((line): line is string => line !== undefined).join('\n');
}

async function sendLineRequest(
  channelAccessToken: string,
  endpoint: 'push' | 'broadcast',
  body: object,
): Promise<void> {
  const response = await fetch(`${LINE_MESSAGING_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE ${endpoint} failed (${response.status}): ${details}`);
  }
}

export async function notifyLineTaskDone(options: NotifyLineTaskDoneOptions): Promise<LineTaskNotifyResult> {
  const channelAccessToken = options.config.line_channel_access_token?.trim();
  if (channelAccessToken === undefined || channelAccessToken.length === 0) {
    return { sent: false, reason: 'missing_token' };
  }

  const message = buildTaskDoneMessage(options);
  const targetId = options.config.line_target_id?.trim();
  const messages = [{ type: 'text', text: message }];

  if (targetId !== undefined && targetId.length > 0) {
    await sendLineRequest(channelAccessToken, 'push', {
      to: targetId,
      messages,
    });
    return { sent: true, mode: 'push' };
  }

  await sendLineRequest(channelAccessToken, 'broadcast', { messages });
  return { sent: true, mode: 'broadcast' };
}

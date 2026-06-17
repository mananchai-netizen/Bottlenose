import { NextResponse } from 'next/server';
import { getMachineConfig, saveMachineConfig } from '@/lib/config';
import { invalidateServerConfigCache } from '@/lib/server-config';
import type { MachineConfig } from '@/lib/types';

function maskToken(token: string | undefined, prefix?: string): string | undefined {
  if (!token || token.length < 4) return undefined;
  if (prefix && token.startsWith(prefix)) {
    const body = token.slice(prefix.length);
    const visibleBody = body.length > 3 ? body.slice(0, 3) : body.slice(0, 1);
    return `${prefix}${visibleBody}...${token.slice(-3)}`;
  }
  const visible = token.length >= 6 ? token.slice(0, 3) : token.slice(0, 1);
  return `${visible}...${token.slice(-Math.min(3, token.length - visible.length))}`;
}

export async function GET() {
  const config = await getMachineConfig();
  if (config === null) {
    return NextResponse.json({ error: 'No config found' }, { status: 404 });
  }
  const safe = {
    ...config,
    notion_token: undefined,
    claude_api_key: undefined,
    gemini_api_key: undefined,
    discord_token: undefined,
    line_channel_access_token: undefined,
    line_channel_secret: undefined,
    line_notify_token: undefined,
    github_token: undefined,
    llm_server_token: undefined,
    runpod_api_key: undefined,
    runpod_callback_secret: undefined,
    notion_token_masked:                maskToken(config.notion_token, 'ntn_'),
    claude_api_key_masked:              maskToken(config.claude_api_key, 'sk-ant-api-'),
    gemini_api_key_masked:              maskToken(config.gemini_api_key),
    discord_token_masked:               maskToken(config.discord_token),
    line_channel_access_token_masked:   maskToken(config.line_channel_access_token),
    line_channel_secret_masked:         maskToken(config.line_channel_secret),
    line_notify_token_masked:           maskToken(config.line_notify_token),
    github_token_masked:                maskToken(config.github_token),
    llm_server_token_masked:            maskToken(config.llm_server_token),
    runpod_api_key_masked:              maskToken(config.runpod_api_key, 'rpa_'),
    runpod_callback_secret_masked:      maskToken(config.runpod_callback_secret),
  };
  return NextResponse.json(safe);
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<MachineConfig>;
  const existing = await getMachineConfig();
  if (existing === null) {
    return NextResponse.json({ error: 'Run `han init` first' }, { status: 400 });
  }
  const updated: MachineConfig = {
    ...existing,
    ...body,
    machine_id: existing.machine_id, // ห้ามเปลี่ยน
  };
  await saveMachineConfig(updated);
  invalidateServerConfigCache();
  return NextResponse.json({ ok: true });
}

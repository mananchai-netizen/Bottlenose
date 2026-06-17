import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, isFullPage } from '@notionhq/client';
import { broadcastMessage } from '../messaging/lineHandler.js';

const POLL_INTERVAL_MS = 30_000;
const notifiedIds = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

interface HanConfig {
  notion_token: string;
}

interface ProjectConfig {
  notion_db_id: string;
}

function loadHanConfig(): { token: string; dbIds: string[] } | null {
  try {
    const configPath = path.join(os.homedir(), '.han', 'config.json');
    const projectsPath = path.join(os.homedir(), '.han', 'projects.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as HanConfig;
    const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf8')) as ProjectConfig[];
    const dbIds = projects.map((p) => p.notion_db_id).filter(Boolean);
    return { token: config.notion_token, dbIds };
  } catch {
    return null;
  }
}

function getTitle(page: Parameters<typeof isFullPage>[0]): string {
  if (!isFullPage(page)) return 'Untitled';
  const prop = page.properties['title'];
  if (prop?.type === 'title' && prop.title.length > 0) {
    return prop.title.map((t) => t.plain_text).join('').trim() || 'Untitled';
  }
  return 'Untitled';
}

async function pollDb(notion: Client, dbId: string, broadcast: boolean): Promise<void> {
  const response = await notion.databases.query({
    database_id: dbId,
    filter: { property: 'status', select: { equals: 'Done' } },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 50,
  });

  for (const page of response.results) {
    if (!isFullPage(page)) continue;
    if (notifiedIds.has(page.id)) continue;
    notifiedIds.add(page.id);

    const title = getTitle(page);
    if (!broadcast) continue;

    console.log(`[DonePoller] notifying: ${page.id} ${title}`);
    await broadcastMessage(`✅ Task เสร็จแล้ว: ${title}`).catch((err: unknown) => {
      console.error('[DonePoller] broadcast error:', (err as Error).message);
    });
  }
}

async function pollAll(notion: Client, dbIds: string[], broadcast: boolean): Promise<void> {
  for (const dbId of dbIds) {
    await pollDb(notion, dbId, broadcast).catch((err: unknown) => {
      console.error('[DonePoller] Notion error:', (err as Error).message);
    });
  }
}

export async function startDoneTaskPoller(): Promise<void> {
  const hanConfig = loadHanConfig();
  if (hanConfig === null) {
    console.warn('[DonePoller] ~/.han/config.json not found — skipping poller');
    return;
  }

  const { token, dbIds } = hanConfig;
  if (dbIds.length === 0) {
    console.warn('[DonePoller] No projects configured — skipping poller');
    return;
  }

  const notion = new Client({ auth: token });

  // Seed existing Done tasks silently so we don't re-broadcast on startup
  await pollAll(notion, dbIds, false);
  console.log(`[DonePoller] Seeded existing Done tasks: ${notifiedIds.size}`);
  console.log(`[DonePoller] Started — watching ${dbIds.length} DB(s), poll every ${POLL_INTERVAL_MS / 1000}s`);

  pollTimer = setInterval(() => {
    void pollAll(notion, dbIds, true);
  }, POLL_INTERVAL_MS);
}

export function stopDoneTaskPoller(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

import { Client, isFullPage } from '@notionhq/client';
import type {
  CreatePageParameters,
  PageObjectResponse,
  UpdatePageParameters,
} from '@notionhq/client/build/src/api-endpoints.js';
import type { BrainName, HanTask, TaskStatus, TaskType, TaskUpdateExtra } from '../types.js';

type PageProps = PageObjectResponse['properties'];
type PropValue = PageProps[string];
type CreateProperties = Exclude<CreatePageParameters['properties'], undefined>;
type UpdateProperties = Exclude<UpdatePageParameters['properties'], undefined>;

const NOTION_RICH_TEXT_CONTENT_LIMIT = 2000;
const NOTION_RATE_LIMIT_RETRIES = 3;
const NOTION_RATE_LIMIT_FALLBACK_MS = 1_000;

export interface NotionCreateTaskInput {
  title: string;
  project_id: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: number;
  assigned_to?: string;
  retry_count?: number;
  planned_by?: string;
  planned_at?: string;
  claimed_by?: string;
  claimed_at?: string;
  heartbeat_at?: string;
  output_url?: string;
  error_log?: string;
  brain_used?: BrainName;
  context?: string;
}

export interface NotionCreateTaskResult {
  id: string;
  url?: string;
}

export interface NotionUpdateTaskResult {
  id: string;
  url?: string;
}

export interface NotionTaskPage {
  page_id: string;
  title?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: number;
  assigned_to?: string;
  retry_count?: number;
  planned_by?: string;
  planned_at?: string;
  claimed_by?: string;
  output_url?: string;
  error_log?: string;
  brain_used?: BrainName;
  project_id?: string;
  context?: string;
  url?: string;
}

export class NotionClient {
  private readonly client: Client;
  private readonly dbId: string;

  constructor(token: string, dbId: string) {
    this.client = new Client({ auth: token });
    this.dbId = dbId;
  }

  /** ดึง tasks ที่ status == Approve และ assigned_to == machineId หรือว่าง */
  async createTask(input: NotionCreateTaskInput): Promise<NotionCreateTaskResult> {
    const page = await withNotionRateLimitRetry('create task', () =>
      this.client.pages.create({
        parent: {
          database_id: this.dbId,
        },
        properties: buildCreateTaskProperties(input),
      }),
    );

    return {
      id: page.id,
      ...('url' in page && typeof page.url === 'string' ? { url: page.url } : {}),
    };
  }

  async getApprovedTasks(machineId: string, acceptTypes: string[]): Promise<HanTask[]> {
    const response = await withNotionRateLimitRetry('query approved tasks', () =>
      this.client.databases.query({
        database_id: this.dbId,
        filter: {
          and: [
            { property: 'status', select: { equals: 'Approve' } },
            { property: 'type', select: { is_not_empty: true } },
          ],
        },
        sorts: [{ property: 'priority', direction: 'ascending' }],
      }),
    );

    const tasks: HanTask[] = [];

    for (const page of response.results) {
      if (!isFullPage(page)) continue;

      const taskPage = mapTaskPage(page);
      if (taskPage.type === undefined || !acceptTypes.includes(taskPage.type)) continue;

      if (taskPage.assigned_to !== undefined && taskPage.assigned_to !== machineId) continue;

      const retryCount = taskPage.retry_count ?? 0;
      if (retryCount >= 3) continue;

      const task: HanTask = {
        id: page.id.replace(/-/g, ''),
        notion_page_id: page.id,
        title: taskPage.title ?? 'Untitled',
        type: taskPage.type,
        status: 'Approve',
        priority: taskPage.priority ?? 99,
        retry_count: retryCount,
      };

      if (taskPage.project_id !== undefined) task.project_id = taskPage.project_id;
      if (taskPage.assigned_to !== undefined) task.assigned_to = taskPage.assigned_to;
      if (taskPage.context !== undefined) task.context = taskPage.context;
      if (taskPage.output_url !== undefined) task.output_url = taskPage.output_url;
      if (taskPage.brain_used !== undefined) task.brain_used = taskPage.brain_used;

      tasks.push(task);
    }

    return tasks;
  }

  async queryApprovedTasks(): Promise<NotionTaskPage[]> {
    const tasks: NotionTaskPage[] = [];
    let startCursor: string | undefined;

    do {
      const response = await withNotionRateLimitRetry('query approved tasks page', () =>
        this.client.databases.query({
          database_id: this.dbId,
          filter: {
            property: 'status',
            select: { equals: 'Approve' },
          },
          sorts: [{ property: 'priority', direction: 'ascending' }],
          ...(startCursor !== undefined && { start_cursor: startCursor }),
        }),
      );

      for (const page of response.results) {
        if (isFullPage(page)) {
          tasks.push(mapTaskPage(page));
        }
      }

      startCursor = response.next_cursor ?? undefined;
    } while (startCursor !== undefined);

    return tasks;
  }

  /** อัปเดต status + optional fields */
  async getTaskPage(pageId: string): Promise<NotionTaskPage | null> {
    const page = await withNotionRateLimitRetry('retrieve task page', () =>
      this.client.pages.retrieve({ page_id: pageId }),
    );

    return isFullPage(page) ? mapTaskPage(page) : null;
  }

  async hasAnyTask(): Promise<boolean> {
    const response = await withNotionRateLimitRetry('check any task', () =>
      this.client.databases.query({
        database_id: this.dbId,
        page_size: 1,
      }),
    );

    return response.results.length > 0;
  }

  async updateStatus(pageId: string, status: TaskStatus, extra?: TaskUpdateExtra): Promise<void> {
    await withNotionRateLimitRetry('update task status', () =>
      this.client.pages.update({
        page_id: pageId,
        properties: buildUpdateStatusProperties(status, extra),
      }),
    );
  }

  async updateTask(pageId: string, status: TaskStatus, extra?: TaskUpdateExtra): Promise<NotionUpdateTaskResult> {
    const page = await withNotionRateLimitRetry('update task', () =>
      this.client.pages.update({
        page_id: pageId,
        properties: buildUpdateStatusProperties(status, extra),
      }),
    );

    return {
      id: page.id,
      ...('url' in page && typeof page.url === 'string' ? { url: page.url } : {}),
    };
  }

  /** Heartbeat ping — ต่ออายุ task ไม่ให้ถูก watchdog reset */
  async updateHeartbeat(pageId: string): Promise<void> {
    await withNotionRateLimitRetry('update heartbeat', () =>
      this.client.pages.update({
        page_id: pageId,
        properties: { heartbeat_at: { date: { start: new Date().toISOString() } } },
      }),
    );
  }
}

// ─── Pure helper functions (type-safe via discriminated union) ────────────────

async function withNotionRateLimitRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= NOTION_RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (!isNotionRateLimitError(err) || attempt === NOTION_RATE_LIMIT_RETRIES) {
        throw err;
      }

      const waitMs = getRetryAfterMs(err) ?? Math.min(
        NOTION_RATE_LIMIT_FALLBACK_MS * 2 ** attempt,
        10_000,
      );
      console.warn(
        `Notion rate limited during ${operationName}; retrying in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${NOTION_RATE_LIMIT_RETRIES})`,
      );
      await sleep(waitMs);
    }
  }

  return operation();
}

function isNotionRateLimitError(err: unknown): boolean {
  const record = asRecord(err);
  return record['status'] === 429 || record['code'] === 'rate_limited';
}

function getRetryAfterMs(err: unknown): number | null {
  const direct = getHeaderValue(asRecord(err)['headers'], 'retry-after');
  const nested = getHeaderValue(asRecord(asRecord(err)['response'])['headers'], 'retry-after');
  const value = direct ?? nested;
  if (value === null) return null;

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.max(1_000, seconds * 1_000);
}

function getHeaderValue(headers: unknown, name: string): string | null {
  if (headers === null || headers === undefined) return null;
  if (typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function') {
    const value = headers.get(name) as unknown;
    return typeof value === 'string' ? value : null;
  }

  const record = asRecord(headers);
  const lowerName = name.toLowerCase();
  const value = record[name] ?? record[lowerName];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCreateTaskProperties(input: NotionCreateTaskInput): CreateProperties {
  const properties: CreateProperties = {
    title: {
      title: [{ text: { content: input.title } }],
    },
    project_id: {
      select: { name: input.project_id },
    },
  };

  if (input.type !== undefined) properties.type = { select: { name: input.type } };
  if (input.status !== undefined) properties.status = { select: { name: input.status } };
  if (input.priority !== undefined) properties.priority = { number: input.priority };
  if (input.assigned_to !== undefined) properties.assigned_to = { select: { name: input.assigned_to } };
  if (input.retry_count !== undefined) properties.retry_count = { number: input.retry_count };
  if (input.planned_by !== undefined) properties.planned_by = { select: { name: input.planned_by } };
  if (input.planned_at !== undefined) properties.planned_at = { date: { start: input.planned_at } };
  if (input.claimed_by !== undefined) properties.claimed_by = { select: { name: input.claimed_by } };
  if (input.claimed_at !== undefined) properties.claimed_at = { date: { start: input.claimed_at } };
  if (input.heartbeat_at !== undefined) properties.heartbeat_at = { date: { start: input.heartbeat_at } };
  if (input.output_url !== undefined) properties.output_url = { url: input.output_url };
  if (input.error_log !== undefined) {
    properties.error_log = {
      rich_text: [{ type: 'text', text: { content: truncateRichText(input.error_log) } }],
    };
  }
  if (input.brain_used !== undefined) properties.brain_used = { select: { name: input.brain_used } };
  if (input.context !== undefined) {
    properties.context = {
      rich_text: [{ type: 'text', text: { content: truncateRichText(input.context) } }],
    };
  }

  return properties;
}

function buildUpdateStatusProperties(status: TaskStatus, extra?: TaskUpdateExtra): UpdateProperties {
  const properties: UpdateProperties = {
    status: { select: { name: status } },
  };

  if (extra?.claimed_by !== undefined) {
    properties.claimed_by = { select: { name: extra.claimed_by } };
  }
  if (extra?.claimed_at !== undefined) {
    properties.claimed_at = { date: { start: extra.claimed_at } };
  }
  if (extra?.heartbeat_at !== undefined) {
    properties.heartbeat_at = { date: { start: extra.heartbeat_at } };
  }
  if (extra?.output_url !== undefined) {
    properties.output_url = { url: extra.output_url };
  }
  if (extra?.error_log !== undefined) {
    properties.error_log = {
      rich_text: extra.error_log === null
        ? []
        : [{ type: 'text', text: { content: truncateRichText(extra.error_log) } }],
    };
  }
  if (extra?.brain_used !== undefined) {
    properties.brain_used = { select: { name: extra.brain_used } };
  }
  if (extra?.retry_count !== undefined) {
    properties.retry_count = { number: extra.retry_count };
  }

  return properties;
}

function mapTaskPage(page: PageObjectResponse): NotionTaskPage {
  const props = page.properties;
  const title = getTitle(props, 'title');
  const type = getSelect(props, 'type') as TaskType | null;
  const status = getSelect(props, 'status') as TaskStatus | null;
  const priority = getNumber(props, 'priority');
  const assignedTo = getSelect(props, 'assigned_to');
  const retryCount = getNumber(props, 'retry_count');
  const plannedBy = getSelect(props, 'planned_by');
  const plannedAt = getDate(props, 'planned_at');
  const claimedBy = getSelect(props, 'claimed_by');
  const outputUrl = getUrl(props, 'output_url');
  const errorLog = getRichText(props, 'error_log');
  const brainUsed = getSelect(props, 'brain_used') as BrainName | null;
  const projectId = getSelect(props, 'project_id');
  const context = getRichText(props, 'context');

  return {
    page_id: page.id,
    ...(title !== null && { title }),
    ...(type !== null && { type }),
    ...(status !== null && { status }),
    ...(priority !== null && { priority }),
    ...(assignedTo !== null && { assigned_to: assignedTo }),
    ...(retryCount !== null && { retry_count: retryCount }),
    ...(plannedBy !== null && { planned_by: plannedBy }),
    ...(plannedAt !== null && { planned_at: plannedAt }),
    ...(claimedBy !== null && { claimed_by: claimedBy }),
    ...(outputUrl !== null && { output_url: outputUrl }),
    ...(errorLog !== null && { error_log: errorLog }),
    ...(brainUsed !== null && { brain_used: brainUsed }),
    ...(projectId !== null && { project_id: projectId }),
    ...(context !== null && { context }),
    url: page.url,
  };
}

function getTitle(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'title' && prop.title.length > 0) {
    return prop.title[0]?.plain_text ?? null;
  }
  return null;
}

function getSelect(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'select') return prop.select?.name ?? null;
  return null;
}

function getNumber(props: PageProps, key: string): number | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'number') return prop.number;
  return null;
}

function getUrl(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'url') return prop.url ?? null;
  return null;
}

function getDate(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'date') return prop.date?.start ?? null;
  return null;
}

function getRichText(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key];
  if (prop?.type === 'rich_text' && prop.rich_text.length > 0) {
    return prop.rich_text[0]?.plain_text ?? null;
  }
  return null;
}

function truncateRichText(value: string): string {
  if (value.length <= NOTION_RICH_TEXT_CONTENT_LIMIT) return value;
  const suffix = '\n\n[truncated for Notion rich_text 2000 character limit]';
  return `${value.slice(0, NOTION_RICH_TEXT_CONTENT_LIMIT - suffix.length)}${suffix}`;
}

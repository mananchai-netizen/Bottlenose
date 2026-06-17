import { getMachineConfig, getProjects } from '../config.js';
import { GoogleDriveClient, type DriveFile } from '../integrations/google-drive.js';
import { NotionClient } from '../integrations/notion.js';
import { resolveBrain } from '../brains/router.js';
import type { BrainName, TaskStatus, TaskType } from '../types.js';

type PlannedTaskType = Extract<TaskType, 'dev' | 'doc' | 'sheet' | 'slide'>;
type PlannedTaskStatus = Extract<TaskStatus, 'New'>;
type GoogleDriveFileType = 'all' | 'doc' | 'sheet' | 'slide';

export interface GoogleDriveTaskAgentDirectOptions {
  projectId: string;
  dryRun?: boolean;
  maxContextChars?: number;
}

export interface GoogleDriveTaskAgentDirectResult {
  brainUsed: BrainName;
  tasks: PlannedTask[];
  created: Array<{
    title: string;
    id: string;
    url?: string;
  }>;
}

export interface PlannedTask {
  title: string;
  type: PlannedTaskType;
  status: PlannedTaskStatus;
  priority: number;
  context: string;
}

interface GoogleDriveFileContent {
  id: string;
  name: string;
  mimeType: string;
  content?: string;
  error?: string;
}

interface GetGoogleDriveFilesResult {
  project_id: string;
  folder_id: string;
  type: GoogleDriveFileType;
  total_files: number;
  matched_files: number;
  files: GoogleDriveFileContent[];
}

const SYSTEM_PROMPT = `You are Han AI planning agent.

Your job is to read Google Drive content and extract concrete actionable tasks.
Return only a valid JSON array. Do not include markdown, explanation, comments, or code fences.

Each task must have:
- title: string
- type: one of "dev", "doc", "sheet", "slide"
- status: always "New"
- priority: number, where 1 is highest priority
- context: string, detailed enough for another agent to execute

Rules:
- Create tasks only from the provided content.
- Do not invent requirements.
- Do not duplicate tasks.
- Prefer small actionable tasks over broad vague tasks.
- Use "dev" for implementation/coding work.
- Use "doc" for documentation or written specs.
- Use "sheet" for spreadsheet/data table work.
- Use "slide" for presentation work.
- Keep titles concise and imperative.`;

const MIME_TYPES = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slide: 'application/vnd.google-apps.presentation',
} as const;

const validTaskTypes = new Set<PlannedTaskType>(['dev', 'doc', 'sheet', 'slide']);
const validDriveTypes = new Set<GoogleDriveFileType>(['all', 'doc', 'sheet', 'slide']);
function requireNonEmpty(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing "${label}"`);
  }

  return value.trim();
}

function normalizeOptions(
  options: GoogleDriveTaskAgentDirectOptions,
): Required<GoogleDriveTaskAgentDirectOptions> {
  const maxContextChars = options.maxContextChars ?? 30_000;
  if (!Number.isFinite(maxContextChars) || maxContextChars <= 0) {
    throw new Error('Invalid maxContextChars. Use a positive number.');
  }

  if (options.projectId.trim().length === 0) {
    throw new Error('Missing projectId.');
  }

  return {
    projectId: options.projectId.trim(),
    dryRun: options.dryRun ?? false,
    maxContextChars,
  };
}

function normalizeFolderId(value: string): string {
  const match = /\/folders\/([A-Za-z0-9_-]+)/.exec(value);
  return match?.[1] ?? value;
}

function getTargetMimeTypes(type: GoogleDriveFileType): string[] {
  if (type === 'all') return Object.values(MIME_TYPES);
  return [MIME_TYPES[type]];
}

async function readFileContent(drive: GoogleDriveClient, file: DriveFile): Promise<string> {
  switch (file.mimeType) {
    case MIME_TYPES.doc:
      return drive.getDocContent(file.id);
    case MIME_TYPES.sheet:
      return drive.getSheetContent(file.id);
    case MIME_TYPES.slide:
      return drive.getSlideContent(file.id);
    default:
      throw new Error(`Unsupported file type: ${file.mimeType}`);
  }
}

async function getGoogleDriveFiles(projectId: string, type: GoogleDriveFileType = 'all'): Promise<GetGoogleDriveFilesResult> {
  if (!validDriveTypes.has(type)) {
    throw new Error(`Invalid "type". Use all, doc, sheet, or slide.`);
  }

  const config = getMachineConfig();
  if (config === null) {
    throw new Error('Run `han init` first. Machine config not found.');
  }
  const projects = getProjects();
  const project = projects.find((item) => item.project_id === projectId);

  if (project === undefined) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const folderId = normalizeFolderId(requireNonEmpty(project.google_drive_folder_id, 'google_drive_folder_id'));
  const drive = new GoogleDriveClient({
    ...(config.google_key_path !== undefined && { keyPath: config.google_key_path }),
    ...(config.google_oauth_token_path !== undefined && { oauthTokenPath: config.google_oauth_token_path }),
    ...(config.google_oauth_client_path !== undefined && { oauthClientPath: config.google_oauth_client_path }),
  });
  const allFiles = await drive.listFiles(folderId);
  const targetMimeTypes = getTargetMimeTypes(type);
  const matchedFiles = allFiles.filter((file) => targetMimeTypes.includes(file.mimeType));
  const files: GoogleDriveFileContent[] = [];

  for (const file of matchedFiles) {
    try {
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        content: await readFileContent(drive, file),
      });
    } catch (error) {
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    project_id: projectId,
    folder_id: folderId,
    type,
    total_files: allFiles.length,
    matched_files: matchedFiles.length,
    files,
  };
}

function getBrainName(config: NonNullable<ReturnType<typeof getMachineConfig>>): BrainName {
  return config.brain.doc ?? config.brain.default;
}

function buildDriveContext(
  files: Array<{ name: string; mimeType: string; content?: string; error?: string }>,
  maxChars: number,
): string {
  const parts = files.map((file) => {
    const content = file.content ?? `[unavailable: ${file.error ?? 'no content'}]`;
    return `=== ${file.name} (${file.mimeType}) ===\n${content}`;
  });
  const context = parts.join('\n\n');
  return context.length > maxChars ? `${context.slice(0, maxChars)}\n...[truncated]` : context;
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Brain output did not contain a JSON array.');
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

function validatePlannedTasks(value: unknown): PlannedTask[] {
  if (!Array.isArray(value)) {
    throw new Error('Brain output must be a JSON array.');
  }

  return value.map((item, index) => {
    const task = item as Partial<PlannedTask>;

    if (typeof task.title !== 'string' || task.title.trim().length === 0) {
      throw new Error(`Task ${index + 1} has invalid title.`);
    }
    if (typeof task.type !== 'string' || !validTaskTypes.has(task.type as PlannedTaskType)) {
      throw new Error(`Task ${index + 1} has invalid type.`);
    }
    if (task.status !== 'New') {
      throw new Error(`Task ${index + 1} status must be "New".`);
    }
    if (typeof task.priority !== 'number' || !Number.isFinite(task.priority)) {
      throw new Error(`Task ${index + 1} has invalid priority.`);
    }
    if (typeof task.context !== 'string' || task.context.trim().length === 0) {
      throw new Error(`Task ${index + 1} has invalid context.`);
    }

    return {
      title: task.title.trim(),
      type: task.type as PlannedTaskType,
      status: 'New',
      priority: task.priority,
      context: task.context.trim(),
    };
  });
}

async function createPlannedNotionTask(task: PlannedTask, projectId: string, brainName: BrainName): Promise<{ id: string; url?: string }> {
  const config = getMachineConfig();
  if (config === null) {
    throw new Error('Run `han init` first. Machine config not found.');
  }

  const project = getProjects().find((item) => item.project_id === projectId);
  if (project === undefined) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (project.notion_db_id.length === 0) {
    throw new Error(`Project "${projectId}" has no notion_db_id configured.`);
  }

  const notion = new NotionClient(config.notion_token, project.notion_db_id);
  return notion.createTask({
    ...task,
    project_id: projectId,
    planned_by: config.machine_id,
    planned_at: new Date().toISOString(),
    brain_used: brainName,
  });
}

export async function runGoogleDriveTaskAgentDirect(
  rawOptions: GoogleDriveTaskAgentDirectOptions,
): Promise<GoogleDriveTaskAgentDirectResult> {
  const options = normalizeOptions(rawOptions);
  const config = getMachineConfig();

  if (config === null) {
    throw new Error('Run `han init` first. Machine config not found.');
  }

  console.log(`Reading Google Drive files for project: ${options.projectId}`);
  const driveResult = await getGoogleDriveFiles(options.projectId);
  if (driveResult.files.length === 0) {
    throw new Error('No Google Drive file content returned.');
  }

  const driveContext = buildDriveContext(driveResult.files, options.maxContextChars);
  const brain = resolveBrain(config, 'doc');
  const brainName = getBrainName(config);
  const userPrompt = [
    `Project ID: ${options.projectId}`,
    '',
    'Google Drive files:',
    driveContext,
    '',
    'Create a task plan from the content above.',
    'Return only JSON array.',
  ].join('\n');

  console.log(`Running brain: ${brainName}`);
  const brainResult = await brain.run({ systemPrompt: SYSTEM_PROMPT, userPrompt });
  const tasks = validatePlannedTasks(extractJsonArray(brainResult.text));

  console.log(`Planned tasks: ${tasks.length}`);
  for (const task of tasks) {
    console.log(`- [${task.type}] P${task.priority} ${task.title}`);
  }

  if (options.dryRun) {
    console.log('Dry run enabled. No Notion tasks were created.');
    return {
      brainUsed: brainName,
      tasks,
      created: [],
    };
  }

  const createdTasks: GoogleDriveTaskAgentDirectResult['created'] = [];
  for (const task of tasks) {
    const created = await createPlannedNotionTask(task, options.projectId, brainName);

    console.log(`Created: ${task.title} -> ${created.id}${created.url ? ` (${created.url})` : ''}`);
    createdTasks.push({
      title: task.title,
      id: created.id,
      ...(created.url !== undefined && { url: created.url }),
    });
  }

  return {
    brainUsed: brainName,
    tasks,
    created: createdTasks,
  };
}

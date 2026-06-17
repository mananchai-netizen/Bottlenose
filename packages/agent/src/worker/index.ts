import fs from 'fs';
import chalk from 'chalk';
import { getMachineConfig, getMachineConfigPath, getProjects, getProjectsConfigPath } from '../config.js';
import { NotionClient } from '../integrations/notion.js';
import { RedisLock } from './redis-lock.js';
import { MachineRegistry } from './machine-registry.js';
import { executeTask } from '../executors/index.js';
import type { ExecutorResult } from '../executors/index.js';
import { notifyLineTaskDone } from '../messaging/line-task-notifier.js';
import { runGoogleDriveTaskAgentDirect } from '../planning/google-drive-task-planner.js';
import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';

const DEFAULT_POLL_MS = 30_000;
const MAX_POLL_MS = 120_000;
const DEFAULT_TASK_TIMEOUT_SECONDS = 240;

type NotionProjectClient = { project: ProjectConfig; client: NotionClient };
type ConfigStamp = { configMtime: number | null; projectsMtime: number | null };
type WorkerRuntime = {
  config: MachineConfig;
  projects: ProjectConfig[];
  notionClients: NotionProjectClient[];
  stamp: ConfigStamp;
};
type TaskRunResult =
  | ({ ok: true } & ExecutorResult)
  | { ok: false; error: string };
type PlannerRunResult =
  | { ok: true; planned: boolean }
  | { ok: false; error: string };

export type WorkerOnceStatus =
  | 'task_done'
  | 'task_failed'
  | 'tasks_planned'
  | 'tasks_plan_failed'
  | 'no_task'
  | 'no_config'
  | 'no_projects'
  | 'no_notion_projects';

export interface WorkerOnceResult {
  status: WorkerOnceStatus;
  message: string;
  machineName?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  taskType?: string;
  outputUrl?: string;
}

/** Start the polling worker loop - runs until SIGINT/SIGTERM */
export async function startWorker(): Promise<void> {
  const initialConfig = getMachineConfig();
  if (initialConfig === null) {
    console.error(chalk.red('Machine config not found. Run `han init` first.'));
    process.exit(1);
  }

  const projects = getProjects();
  if (projects.length === 0) {
    console.error(chalk.red('No projects configured. Create a project in Han UI first.'));
    process.exit(1);
  }

  let runtime: WorkerRuntime = {
    config: initialConfig,
    projects,
    notionClients: buildNotionClients(initialConfig, projects),
    stamp: getConfigStamp(),
  };

  console.log(chalk.cyan(`Han Agent starting - machine: ${runtime.config.machine_name}`));
  console.log(chalk.gray(`   accept_types: ${runtime.config.accept_types.join(', ')}`));
  console.log(chalk.gray(`   redis: ${runtime.config.redis_url}`));

  const lock = new RedisLock(runtime.config.redis_url, runtime.config.machine_id);
  await lock.connect();

  const registry = new MachineRegistry(
    lock.getRedis(),
    runtime.config.machine_id,
    runtime.config.machine_name,
    runtime.config.accept_types,
  );
  await registry.register();

  if (runtime.notionClients.length === 0) {
    console.error(chalk.red('No projects with notion_db_id configured.'));
    process.exit(1);
  }

  let activeTasks = 0;
  let pollInterval = getBasePollMs(runtime.config);

  const shutdown = async (): Promise<void> => {
    console.log(chalk.yellow('\nShutting down...'));
    await registry.unregister();
    await lock.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(chalk.green(`Worker ready - polling every ${getBasePollMs(runtime.config) / 1000}s`));
  await registry.setActivity('idle', 'Worker ready');

  while (true) {
    runtime = await reloadRuntimeIfChanged(runtime, registry);
    const config = runtime.config;
    const notionClients = runtime.notionClients;

    if (activeTasks >= config.max_concurrent_tasks) {
      await sleep(pollInterval);
      continue;
    }

    let foundTask = false;
    const emptyProjects: NotionProjectClient[] = [];

    outer: for (const { project, client } of notionClients) {
      await registry.setActivity('polling', `Polling Notion: ${projectLabel(project)}`);
      let tasks: Awaited<ReturnType<typeof client.getApprovedTasks>>;
      try {
        tasks = await client.getApprovedTasks(config.machine_id, config.accept_types);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await registry.setActivity('error', `Notion error on ${projectLabel(project)}: ${msg.slice(0, 120)}`);
        process.stdout.write(chalk.yellow(`\r[${project.project_id}] Notion error: ${msg.slice(0, 80)}\n`));
        continue;
      }

      if (tasks.length === 0) {
        try {
          if (!(await client.hasAnyTask())) {
            emptyProjects.push({ project, client });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await registry.setActivity('error', `Notion empty-check error on ${projectLabel(project)}: ${msg.slice(0, 120)}`);
          process.stdout.write(chalk.yellow(`\r[${project.project_id}] Notion empty-check error: ${msg.slice(0, 80)}\n`));
        }

        continue;
      }

      for (const task of tasks) {
        const claimed = await lock.claim(task.id);
        if (!claimed) continue;

        foundTask = true;
        activeTasks++;
        await registry.setActivity(
          'working',
          `Working on ${task.type.toUpperCase()} - ${task.title}`,
        );

        void runTask(task, client, lock, registry, config.machine_id, config, project).finally(() => {
          activeTasks--;
        });

        break outer;
      }
    }

    if (!foundTask && emptyProjects.length > 0) {
      const planned = await maybePlanTasksFromGoogleDrive(emptyProjects[0]!.project, emptyProjects[0]!.client, lock, registry);
      foundTask = planned.ok && planned.planned;
    }

    const basePollMs = getBasePollMs(config);
    pollInterval = foundTask
      ? basePollMs
      : Math.min(Math.max(pollInterval, basePollMs) * 1.5, Math.max(basePollMs, MAX_POLL_MS));

    if (!foundTask) {
      await registry.setActivity('idle', `Waiting, next poll in ${Math.round(pollInterval / 1000)}s`);
      process.stdout.write(
        chalk.gray(`\rNo tasks - next poll in ${Math.round(pollInterval / 1000)}s `),
      );
    }

    await sleep(pollInterval);
  }
}

/** Run one polling pass, execute at most one task, then exit. Useful for scale-to-zero hosts. */
export async function startWorkerOnce(): Promise<void> {
  const result = await runWorkerOnceCore();
  if (result.status === 'no_config') {
    console.error(chalk.red(result.message));
    process.exit(1);
  }
}

/** Run one worker pass without exiting the process. Useful for API and scheduled runners. */
export async function runWorkerOnceCore(): Promise<WorkerOnceResult> {
  const config = getMachineConfig();
  if (config === null) {
    return {
      status: 'no_config',
      message: 'Machine config not found. Run `han init` first.',
    };
  }

  console.log(chalk.cyan(`Han Agent one-shot config loaded - machine: ${config.machine_name}`));
  console.log(chalk.gray(`   google_key_path: ${config.google_key_path ?? '(not configured)'}`));
  console.log(chalk.gray(`   google_oauth_token_path: ${config.google_oauth_token_path ?? '(not configured)'}`));
  console.log(chalk.gray(`   plan_from_drive: ${process.env.HAN_PLAN_FROM_DRIVE ?? 'empty'}`));

  const projects = getProjects();
  console.log(chalk.gray(`   projects: ${projects.length}`));
  if (projects.length === 0) {
    const message = 'No projects configured - exiting.';
    console.log(chalk.gray(message));
    return {
      status: 'no_projects',
      machineName: config.machine_name,
      message,
    };
  }

  const notionClients = buildNotionClients(config, projects);
  if (notionClients.length === 0) {
    const message = 'No projects with notion_db_id configured - exiting.';
    console.log(chalk.gray(message));
    return {
      status: 'no_notion_projects',
      machineName: config.machine_name,
      message,
    };
  }

  console.log(chalk.cyan(`Han Agent one-shot starting - machine: ${config.machine_name}`));
  console.log(chalk.gray(`   accept_types: ${config.accept_types.join(', ')}`));
  console.log(chalk.gray(`   redis: ${config.redis_url}`));

  const lock = new RedisLock(config.redis_url, config.machine_id);
  await lock.connect();

  const registry = new MachineRegistry(
    lock.getRedis(),
    config.machine_id,
    config.machine_name,
    config.accept_types,
  );
  await registry.register();

  try {
    const emptyProjects: NotionProjectClient[] = [];

    for (const { project, client } of notionClients) {
      await registry.setActivity('polling', `One-shot polling Notion: ${projectLabel(project)}`);

      let tasks: Awaited<ReturnType<typeof client.getApprovedTasks>>;
      try {
        tasks = await client.getApprovedTasks(config.machine_id, config.accept_types);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await registry.setActivity('error', `Notion error on ${projectLabel(project)}: ${msg.slice(0, 120)}`);
        console.error(chalk.yellow(`[${project.project_id}] Notion error: ${msg}`));
        continue;
      }

      if (tasks.length === 0) {
        try {
          if (process.env.HAN_PLAN_FROM_DRIVE === 'always' || !(await client.hasAnyTask())) {
            emptyProjects.push({ project, client });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await registry.setActivity('error', `Notion empty-check error on ${projectLabel(project)}: ${msg.slice(0, 120)}`);
          console.error(chalk.yellow(`[${project.project_id}] Notion empty-check error: ${msg}`));
        }

        continue;
      }

      for (const task of tasks) {
        const claimed = await lock.claim(task.id);
        if (!claimed) continue;

        await registry.setActivity('working', `Working on ${task.type.toUpperCase()} - ${task.title}`);
        const result = await runTask(task, client, lock, registry, config.machine_id, config, project);
        if (!result.ok) {
          return {
            status: 'task_failed',
            machineName: config.machine_name,
            projectId: project.project_id,
            taskId: task.id,
            taskTitle: task.title,
            taskType: task.type,
            message: `Task failed: ${result.error}`,
          };
        }

        return {
          status: 'task_done',
          machineName: config.machine_name,
          projectId: project.project_id,
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          ...(result.outputUrl !== undefined && { outputUrl: result.outputUrl }),
          message: `Executed task: ${task.title}`,
        };
      }
    }

    if (emptyProjects.length > 0) {
      const planned = await maybePlanTasksFromGoogleDrive(emptyProjects[0]!.project, emptyProjects[0]!.client, lock, registry);
      if (!planned.ok) {
        return {
          status: 'tasks_plan_failed',
          machineName: config.machine_name,
          projectId: emptyProjects[0]!.project.project_id,
          message: `Google Drive planner failed: ${planned.error}`,
        };
      }

      if (planned.planned) {
        return {
          status: 'tasks_planned',
          machineName: config.machine_name,
          projectId: emptyProjects[0]!.project.project_id,
          message: `Created tasks from Google Drive: ${projectLabel(emptyProjects[0]!.project)}`,
        };
      }
    }

    await registry.setActivity('idle', 'One-shot found no tasks');
    const message = 'No approved tasks found - exiting.';
    console.log(chalk.gray(message));
    return {
      status: 'no_task',
      machineName: config.machine_name,
      message,
    };
  } finally {
    await registry.unregister();
    await lock.disconnect();
  }
}

function buildNotionClients(config: MachineConfig, projects: ProjectConfig[]): NotionProjectClient[] {
  return projects
    .filter((p) => {
      if (p.notion_db_id.trim().length === 0) {
        console.log(chalk.yellow(`[${p.project_id}] Skipped: notion_db_id is not configured`));
        return false;
      }

      return true;
    })
    .map((p) => ({
      project: p,
      client: new NotionClient(config.notion_token, p.notion_db_id),
    }));
}

async function reloadRuntimeIfChanged(
  runtime: WorkerRuntime,
  registry: MachineRegistry,
): Promise<WorkerRuntime> {
  const nextStamp = getConfigStamp();
  if (
    nextStamp.configMtime === runtime.stamp.configMtime &&
    nextStamp.projectsMtime === runtime.stamp.projectsMtime
  ) {
    return runtime;
  }

  let nextConfig: MachineConfig | null;
  let nextProjects: ProjectConfig[];
  try {
    nextConfig = getMachineConfig();
    nextProjects = getProjects();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.yellow(`\nConfig reload skipped: ${msg}`));
    return runtime;
  }

  if (nextConfig === null) {
    console.error(chalk.yellow('\nConfig reload skipped: ~/.han/config.json is missing'));
    return runtime;
  }

  const restartFields: string[] = [];
  if (nextConfig.machine_id !== runtime.config.machine_id) restartFields.push('machine_id');
  if (nextConfig.redis_url !== runtime.config.redis_url) restartFields.push('redis_url');

  const effectiveConfig: MachineConfig = {
    ...nextConfig,
    machine_id: runtime.config.machine_id,
    redis_url: runtime.config.redis_url,
  };
  const notionClients = buildNotionClients(effectiveConfig, nextProjects);
  await registry.update(effectiveConfig.machine_name, effectiveConfig.accept_types);
  await registry.setActivity('reloading', `Config reloaded: ${nextProjects.length} project(s)`);

  console.log(
    chalk.green(
      `\nConfig reloaded: accept_types=${effectiveConfig.accept_types.join(', ')} projects=${nextProjects.length}`,
    ),
  );
  if (restartFields.length > 0) {
    console.log(chalk.yellow(`   Restart required to apply: ${restartFields.join(', ')}`));
  }

  return {
    config: effectiveConfig,
    projects: nextProjects,
    notionClients,
    stamp: nextStamp,
  };
}

function getConfigStamp(): ConfigStamp {
  return {
    configMtime: process.env.HAN_CONFIG_JSON !== undefined ? null : getFileMtime(getMachineConfigPath()),
    projectsMtime: process.env.HAN_PROJECTS_JSON !== undefined ? null : getFileMtime(getProjectsConfigPath()),
  };
}

function getFileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getBasePollMs(config: MachineConfig): number {
  const pollSeconds = Number.isFinite(config.poll_interval) ? config.poll_interval : DEFAULT_POLL_MS / 1000;
  return Math.max(1_000, pollSeconds * 1_000);
}

function getTaskTimeoutMs(): number {
  const seconds = Number(process.env.HAN_WORKER_TASK_TIMEOUT_SECONDS ?? String(DEFAULT_TASK_TIMEOUT_SECONDS));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TASK_TIMEOUT_SECONDS * 1000;
  return Math.max(1_000, Math.round(seconds * 1000));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function projectLabel(project: ProjectConfig): string {
  return project.project_name.trim().length > 0 ? project.project_name : project.project_id;
}

async function maybePlanTasksFromGoogleDrive(
  project: ProjectConfig,
  notion: NotionClient,
  lock: RedisLock,
  registry: MachineRegistry,
): Promise<PlannerRunResult> {
  const plannerLockId = `planner:notion-db:${project.notion_db_id}`;
  const claimed = await lock.claim(plannerLockId);

  if (!claimed) {
    process.stdout.write(chalk.gray(`\r[${project.project_id}] Planner already running on another worker `));
    return { ok: true, planned: false };
  }

  try {
    if (project.google_drive_folder_id === undefined || project.google_drive_folder_id.trim().length === 0) {
      await registry.setActivity('idle', `Google Drive not configured: ${projectLabel(project)}`);
      process.stdout.write(chalk.gray(`\r[${project.project_id}] google_drive_folder_id is not configured; planner skipped `));
      return { ok: true, planned: false };
    }

    if (await notion.hasAnyTask()) {
      await registry.setActivity('idle', `Notion already has tasks: ${projectLabel(project)}`);
      process.stdout.write(chalk.gray(`\r[${project.project_id}] Notion DB no longer empty; planner skipped `));
      return { ok: true, planned: false };
    }

    await registry.setActivity('planning', `Reading Google Drive: ${projectLabel(project)}`);
    console.log(chalk.cyan(`\n[${project.project_id}] Notion DB is empty; planning tasks from Google Drive`));
    const taskTimeoutMs = getTaskTimeoutMs();
    const result = await withTimeout(
      runGoogleDriveTaskAgentDirect({ projectId: project.project_id }),
      taskTimeoutMs,
      `Google Drive planner timed out after ${Math.round(taskTimeoutMs / 1000)} seconds`,
    );
    await registry.setActivity('planning', `Created ${result.created.length} task(s) from Google Drive: ${projectLabel(project)}`);
    console.log(chalk.green(`[${project.project_id}] Created ${result.created.length} task(s) from Google Drive`));
    return { ok: true, planned: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await registry.setActivity('error', `Google Drive planner failed on ${projectLabel(project)}: ${msg.slice(0, 120)}`);
    console.error(chalk.yellow(`[${project.project_id}] Google Drive planner skipped/failed: ${msg}`));
    return { ok: false, error: msg };
  } finally {
    await lock.release(plannerLockId);
  }
}

async function runTask(
  task: HanTask,
  notion: NotionClient,
  lock: RedisLock,
  registry: MachineRegistry,
  machineId: string,
  config: MachineConfig,
  project: ProjectConfig,
): Promise<TaskRunResult> {
  console.log(chalk.cyan(`\n[${task.type.toUpperCase()}] ${task.title}`));

  if (task.output_url !== undefined && task.output_url.trim().length > 0) {
    await registry.setActivity('working', `Restoring completed task: ${task.title}`);
    console.log(chalk.yellow('   existing output_url found on Approve task - restoring Done status'));
    await notion.updateStatus(task.notion_page_id, 'Done', {
      output_url: task.output_url,
      ...(task.brain_used !== undefined && { brain_used: task.brain_used }),
      error_log: null,
      retry_count: 0,
    });
    await registry.setActivity('idle', `Restored completed task: ${task.title}`);
    await lock.release(task.id);
    return {
      ok: true,
      outputUrl: task.output_url,
      ...(task.brain_used !== undefined && { brainUsed: task.brain_used }),
    };
  }

  await notion.updateStatus(task.notion_page_id, 'In-Progress', {
    claimed_by: machineId,
    claimed_at: new Date().toISOString(),
  });
  await registry.setCurrentTask(task.id);
  const stopHeartbeat = startTaskHeartbeat(notion, task.notion_page_id);

  try {
    const taskTimeoutMs = getTaskTimeoutMs();
    const result = await withTimeout(
      executeTask(task, config, project),
      taskTimeoutMs,
      `Task timed out after ${Math.round(taskTimeoutMs / 1000)} seconds`,
    );

    if (!(await stillOwnsTask(notion, task.notion_page_id, machineId))) {
      const message = `Skipped completion update for ${task.title}; task is no longer claimed by ${machineId}`;
      await registry.setActivity('idle', message);
      console.log(chalk.yellow(message));
      return { ok: true, ...result };
    }

    await notion.updateStatus(task.notion_page_id, 'Done', {
      ...(result.outputUrl !== undefined && { output_url: result.outputUrl }),
      ...(result.brainUsed !== undefined && { brain_used: result.brainUsed }),
      error_log: null,
      retry_count: 0,
    });

    await notifyLineTaskDone({
      config,
      task,
      project,
      ...(result.outputUrl !== undefined && { outputUrl: result.outputUrl }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`LINE notification failed: ${msg}`));
    });

    console.log(chalk.green(`Done: ${task.title}`));
    if (result.outputUrl !== undefined) {
      console.log(chalk.gray(`   -> ${result.outputUrl}`));
    }
    await registry.setActivity('idle', `Completed ${task.type.toUpperCase()}: ${task.title}`);
    return { ok: true, ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryCount = task.retry_count + 1;
    const newStatus = retryCount >= 3 ? 'Failed' : 'Approve';

    if (!(await stillOwnsTask(notion, task.notion_page_id, machineId))) {
      const message = `Skipped failure update for ${task.title}; task is no longer claimed by ${machineId}`;
      await registry.setActivity('idle', message);
      console.error(chalk.yellow(message));
      console.error(chalk.gray(`   error: ${msg}`));
      return { ok: false, error: msg };
    }

    await notion.updateStatus(task.notion_page_id, newStatus, {
      error_log: msg,
      retry_count: retryCount,
    });

    if (newStatus === 'Failed') {
      await registry.setActivity('error', `Task failed after ${retryCount}/3: ${task.title}`);
      console.error(chalk.red(`Failed: ${task.title} - max retries reached (${retryCount}/3) -> Failed`));
    } else {
      await registry.setActivity('retrying', `Task failed, retrying ${retryCount}/3: ${task.title}`);
      console.error(chalk.red(`Failed: ${task.title} - retry ${retryCount}/3 -> returning to Approve`));
    }
    console.error(chalk.gray(`   error: ${msg}`));
    return { ok: false, error: msg };
  } finally {
    stopHeartbeat();
    await lock.release(task.id);
    await registry.setCurrentTask(undefined);
  }
}

async function stillOwnsTask(
  notion: NotionClient,
  pageId: string,
  machineId: string,
): Promise<boolean> {
  const latest = await notion.getTaskPage(pageId);
  return latest?.status === 'In-Progress' && latest.claimed_by === machineId;
}

function startTaskHeartbeat(
  notion: NotionClient,
  pageId: string,
  intervalMs = 60_000,
): () => void {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    await notion.updateHeartbeat(pageId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`Heartbeat update failed: ${msg}`));
    });
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

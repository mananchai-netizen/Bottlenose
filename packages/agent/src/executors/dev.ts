import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';
import type { ExecutorResult } from './index.js';
import { resolveBrain } from '../brains/router.js';
import { resolveDevWorkspaceBackend } from './dev-workspace-backend.js';

const SYSTEM_PROMPT = `You are Han AI — an autonomous dev agent working inside a cloned git repository.
Your job is to complete the given task by making concrete file changes in that repository.
- Inspect the repository structure first and identify the framework or conventions.
- Modify, create, or delete files directly in the cloned repository as needed.
- Do not only explain, plan, or summarize. Make the necessary code changes.
- Keep changes scoped to the task.
- If the required structure does not exist, create the minimal appropriate files.
- Add or update tests when the repository has a test setup.
- Run a lightweight validation command if one is available.
- When done, output a short summary of changed files and behavior.
- If you cannot make changes, explain the exact blocker.`;

const JSON_SYSTEM_PROMPT = `You are Han AI - an autonomous dev agent.
Return only valid JSON with this shape:
{
  "summary": "Short summary of the change",
  "files": [
    {
      "path": "relative/path/to/file.txt",
      "action": "upsert",
      "content": "Complete UTF-8 file content"
    },
    {
      "path": "relative/path/to/deleted-file.txt",
      "action": "delete"
    }
  ]
}
Rules:
- Return JSON only. Do not wrap it in Markdown.
- Use relative repository paths only.
- Do not use absolute paths, parent-directory paths, or paths inside .git.
- Keep the demo small and scoped to the task.
- Do not modify dependency lockfiles unless the task explicitly requires it.`;

const MAX_DEV_JSON_FILES = 20;
const MAX_DEV_JSON_FILE_CHARS = 200_000;
const BLOCKED_PATH_PARTS = new Set(['.git', 'node_modules']);
const BLOCKED_EXACT_PATHS = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

interface DevBrainFileChange {
  path: string;
  action: 'upsert' | 'delete';
  content?: string;
}

interface DevBrainJsonOutput {
  summary: string;
  files: DevBrainFileChange[];
}

export async function devExecutor(
  task: HanTask,
  config: MachineConfig,
  project: ProjectConfig,
): Promise<ExecutorResult> {
  if (project.github_repo === undefined) {
    throw new Error(`Project "${project.project_id}" has no github_repo configured`);
  }

  if (task.output_url !== undefined && task.output_url.trim().length > 0) {
    console.log(chalk.yellow(`   existing output_url found — skipping dev execution`));
    return {
      outputUrl: task.output_url,
      ...(task.brain_used !== undefined && { brainUsed: task.brain_used }),
    };
  }

  console.log(chalk.gray(`   preparing workspace for ${project.github_repo}...`));
  const workspaceBackend = resolveDevWorkspaceBackend(config);
  const ws = await workspaceBackend.createWorkspace(project.github_repo, task.id);

  try {
    const brain = resolveBrain(config, 'dev');
    const brainName = config.brain.dev ?? config.brain.default;
    const CLI_BRAINS = new Set(['claude-cli', 'claude-sonnet-4-6', 'claude-opus-4-7']);
    const useJsonDevOutput = !CLI_BRAINS.has(brainName);

    const userPrompt = [
      `Task: ${task.title}`,
      task.context !== undefined ? `\nContext:\n${task.context}` : '',
      useJsonDevOutput
        ? [
            `\nRepository files are available to the worker, but you cannot write to them directly.`,
            `Return the complete file changes as JSON using the requested schema.`,
            `For a simple demo, prefer one small hello-world page or file.`,
          ].join('\n')
        : [
            `\nRepository path: ${ws.dir}`,
            `You are already running inside this cloned repository.`,
            `Inspect the repository and make the necessary file changes now.`,
            `Do not stop after analysis. Do not only summarize.`,
          ].join('\n'),
    ].join('\n');

    console.log(chalk.gray(`   running brain: ${brainName}...`));
    const result = await brain.run({
      systemPrompt: useJsonDevOutput ? JSON_SYSTEM_PROMPT : SYSTEM_PROMPT,
      userPrompt,
      ...(useJsonDevOutput ? {} : { workspaceDir: ws.dir }),
    });

    if (useJsonDevOutput) {
      const output = parseDevBrainJsonOutput(result.text);
      applyDevBrainJsonOutput(ws.dir, output);
      console.log(chalk.gray(`   applied ${output.files.length} file change(s) from llm-server JSON`));
    }

    const commitMsg = `han: ${task.title}`;
    const hasChanges = await workspaceBackend.commitAndPush(ws, commitMsg);

    if (!hasChanges) {
      console.log(chalk.yellow('   no file changes detected — skipping PR'));
      throw new Error('Dev task produced no file changes, so no pull request was created.');
    }

    console.log(chalk.gray(`   creating PR on branch ${ws.branch}...`));
    const prBody = [
      result.text.slice(0, 1000),
      `\n---\n🤖 Generated by Han AI | task: ${task.id}`,
    ].join('');

    const prUrl = await workspaceBackend.createPR(ws, task.title, prBody);
    console.log(chalk.green(`   PR: ${prUrl}`));

    return { outputUrl: prUrl, brainUsed: result.brainUsed };
  } finally {
    try {
      ws.cleanup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`   warning: workspace cleanup failed: ${msg}`));
    }
  }
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function parseDevBrainJsonOutput(text: string): DevBrainJsonOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Dev brain output must be valid JSON: ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Dev brain output must be a JSON object.');
  }

  const output = parsed as { summary?: unknown; files?: unknown };
  if (typeof output.summary !== 'string' || output.summary.trim().length === 0) {
    throw new Error('Dev brain output must include a non-empty string "summary".');
  }
  if (!Array.isArray(output.files) || output.files.length === 0) {
    throw new Error('Dev brain output must include a non-empty "files" array.');
  }
  if (output.files.length > MAX_DEV_JSON_FILES) {
    throw new Error(`Dev brain output files array is too large: ${output.files.length}`);
  }

  return {
    summary: output.summary.trim(),
    files: output.files.map(parseDevBrainFileChange),
  };
}

function parseDevBrainFileChange(value: unknown, index: number): DevBrainFileChange {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Dev brain output files[${index}] must be an object.`);
  }

  const candidate = value as { path?: unknown; action?: unknown; content?: unknown };
  if (typeof candidate.path !== 'string' || candidate.path.trim().length === 0) {
    throw new Error(`Dev brain output files[${index}].path must be a non-empty string.`);
  }
  if (candidate.action !== 'upsert' && candidate.action !== 'delete') {
    throw new Error(`Dev brain output files[${index}].action must be "upsert" or "delete".`);
  }

  const repoPath = normalizeAndValidateRepoPath(candidate.path, index);
  if (candidate.action === 'delete') {
    return { path: repoPath, action: 'delete' };
  }

  if (typeof candidate.content !== 'string') {
    throw new Error(`Dev brain output files[${index}].content must be a string for upsert.`);
  }
  if (candidate.content.length > MAX_DEV_JSON_FILE_CHARS) {
    throw new Error(`Dev brain output files[${index}].content is too large.`);
  }

  return {
    path: repoPath,
    action: 'upsert',
    content: candidate.content,
  };
}

function normalizeAndValidateRepoPath(inputPath: string, index: number): string {
  const normalized = inputPath.trim().replace(/\\/g, '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.startsWith('~') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes('\0')
  ) {
    throw new Error(`Dev brain output files[${index}].path must be a relative repository path.`);
  }

  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`Dev brain output files[${index}].path must not contain "." or "..".`);
  }
  if (parts.some((part) => BLOCKED_PATH_PARTS.has(part))) {
    throw new Error(`Dev brain output files[${index}].path targets a blocked directory.`);
  }
  if (BLOCKED_EXACT_PATHS.has(parts.join('/'))) {
    throw new Error(`Dev brain output files[${index}].path targets a blocked lockfile.`);
  }

  return parts.join('/');
}

function applyDevBrainJsonOutput(workspaceDir: string, output: DevBrainJsonOutput): void {
  const root = path.resolve(workspaceDir);
  for (const file of output.files) {
    const target = path.resolve(root, file.path);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Refusing to write outside workspace: ${file.path}`);
    }

    if (file.action === 'delete') {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content ?? '', 'utf8');
  }
}

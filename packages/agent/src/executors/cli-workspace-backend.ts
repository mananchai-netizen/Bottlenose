import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HAN_WS_DIR = path.join(os.tmpdir(), 'han-workspaces');

export interface Workspace {
  dir: string;
  branch: string;
  cleanup: () => void;
}

interface ExistingPullRequest {
  url?: string;
  state?: string;
  mergedAt?: string | null;
}

/** Clone repo และ checkout branch han/<taskId> */
export function createWorkspace(githubRepo: string, taskId: string): Workspace {
  fs.mkdirSync(HAN_WS_DIR, { recursive: true });

  const dir = path.join(HAN_WS_DIR, taskId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

  const repoUrl = normalizeRepoUrl(githubRepo);
  const branch = `han/${taskId}`;

  run(`git clone --depth 1 ${repoUrl} ${dir}`);
  run(`git checkout -b ${branch}`, dir);

  return {
    dir,
    branch,
    cleanup: () => {
      if (process.env.HAN_KEEP_WORKSPACE === '1') {
        console.log(`HAN_KEEP_WORKSPACE=1, keeping workspace: ${dir}`);
        return;
      }
      removeWorkspaceDir(dir);
    },
  };
}

/** Commit ทุกอย่างใน workspace แล้ว push */
export function commitAndPush(ws: Workspace, message: string): boolean {
  const status = runOutput('git status --porcelain', ws.dir);
  if (status.trim() === '') return false; // ไม่มี changes

  run('git add -A', ws.dir);
  run(`git commit -m ${JSON.stringify(message)}`, ws.dir);
  run('git fetch origin main', ws.dir);
  if (!hasCommitsAheadOfMain(ws)) return false;

  runFile('git', ['push', '--force', 'origin', `HEAD:refs/heads/${ws.branch}`], ws.dir);
  return true;
}

/** สร้าง PR ผ่าน gh CLI แล้ว return URL */
export function createPR(ws: Workspace, title: string, body: string): string {
  run('git fetch origin main', ws.dir);
  if (!hasCommitsAheadOfMain(ws)) {
    throw new Error(`Branch ${ws.branch} has no commits ahead of origin/main; skipping PR creation.`);
  }

  const existingPull = findExistingPullRequest(ws);
  if (existingPull !== undefined) {
    if (existingPull.state === 'OPEN') {
      return requireNonEmpty(existingPull.url, 'existing pull request URL');
    }
    throw existingPullRequestClosedError(ws.branch, existingPull);
  }

  const output = runFileOutput('gh', ['pr', 'create', '--title', title, '--body', body, '--head', ws.branch], ws.dir);
  // gh pr create ออก URL บรรทัดสุดท้าย
  const lines = output.trim().split('\n');
  return lines[lines.length - 1]?.trim() ?? '';
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalizeRepoUrl(repo: string): string {
  // รองรับทั้ง "org/repo" และ "https://github.com/org/repo"
  if (repo.startsWith('http')) return repo;
  return `https://github.com/${repo}`;
}

function run(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

function runOutput(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString();
}

function runFileOutput(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, stdio: 'pipe' }).toString();
}

function runFile(command: string, args: string[], cwd?: string): void {
  execFileSync(command, args, { cwd, stdio: 'pipe' });
}

function hasCommitsAheadOfMain(ws: Workspace): boolean {
  const count = Number(runOutput('git rev-list --count origin/main..HEAD', ws.dir).trim());
  return Number.isFinite(count) && count > 0;
}

function findExistingPullRequest(ws: Workspace): ExistingPullRequest | undefined {
  const output = runFileOutput(
    'gh',
    ['pr', 'list', '--head', ws.branch, '--state', 'all', '--json', 'url,state,mergedAt', '--limit', '1'],
    ws.dir,
  );
  const pulls = JSON.parse(output) as ExistingPullRequest[];
  return pulls[0];
}

function requireNonEmpty(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function existingPullRequestClosedError(branch: string, pull: ExistingPullRequest): Error {
  const url = pull.url ?? '(unknown PR URL)';
  const state = pull.mergedAt !== null && pull.mergedAt !== undefined ? 'merged' : (pull.state?.toLowerCase() ?? 'closed');
  return new Error(
    `Branch ${branch} already has a ${state} pull request: ${url}. Create a new Notion task to rerun this work.`,
  );
}

function removeWorkspaceDir(dir: string): void {
  if (!fs.existsSync(dir)) return;

  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  });
}

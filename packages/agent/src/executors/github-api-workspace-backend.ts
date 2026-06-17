import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from './cli-workspace-backend.js';
import type { DevWorkspaceBackend } from './dev-workspace-backend.js';

const HAN_WS_DIR = path.join(os.tmpdir(), 'han-workspaces');
const GITHUB_API_URL = 'https://api.github.com';
const MAX_BLOB_BYTES = 1_000_000;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build']);

interface WorkspaceSnapshot {
  files: Map<string, string>;
}

interface WorkspaceDiff {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface GitHubWorkspaceMetadata {
  repoRef: GitHubRepoRef;
  defaultBranch: string;
  baseCommitSha: string;
  baseTreeSha: string;
}

interface GitHubRepoRef {
  owner: string;
  repo: string;
}

interface GitHubRepositoryResponse {
  default_branch?: string;
}

interface GitHubRefResponse {
  object?: {
    sha?: string;
  };
}

interface GitHubCommitResponse {
  tree?: {
    sha?: string;
  };
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
}

interface GitHubTreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
}

interface GitHubBlobResponse {
  content?: string;
  encoding?: string;
}

interface GitHubCreateBlobResponse {
  sha?: string;
}

interface GitHubCreateTreeResponse {
  sha?: string;
}

interface GitHubCreateCommitResponse {
  sha?: string;
}

interface GitHubCreateTreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string | null;
}

interface GitHubCreatePullResponse {
  html_url?: string;
}

interface GitHubPullResponse {
  html_url?: string;
  state?: string;
  merged_at?: string | null;
}

const snapshots = new WeakMap<Workspace, WorkspaceSnapshot>();
const workspaceMetadata = new WeakMap<Workspace, GitHubWorkspaceMetadata>();

export function createGithubApiWorkspaceBackend(token: string): DevWorkspaceBackend {
  return {
    createWorkspace: (githubRepo, taskId) => createWorkspaceFromGithubApi(githubRepo, taskId, token),
    commitAndPush: (ws, message) => commitAndPushViaGithubApi(ws, message, token),
    createPR: (ws, title, body) => createPullRequestViaGithubApi(ws, title, body, token),
  };
}

async function createWorkspaceFromGithubApi(
  githubRepo: string,
  taskId: string,
  token: string,
): Promise<Workspace> {
  fs.mkdirSync(HAN_WS_DIR, { recursive: true });

  const dir = path.join(HAN_WS_DIR, taskId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const repoRef = parseGithubRepo(githubRepo);
  const repo = await githubRequest<GitHubRepositoryResponse>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}`,
  );
  const defaultBranch = repo.default_branch ?? 'main';
  const branch = `han/${taskId}`;
  await assertReusablePullRequestBranch(token, repoRef, branch);

  const ref = await githubRequest<GitHubRefResponse>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const commitSha = requireString(ref.object?.sha, `default branch ref ${defaultBranch} sha`);
  const commit = await githubRequest<GitHubCommitResponse>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}/git/commits/${commitSha}`,
  );
  const treeSha = requireString(commit.tree?.sha, `default branch ${defaultBranch} tree sha`);
  const tree = await githubRequest<GitHubTreeResponse>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}/git/trees/${treeSha}?recursive=1`,
  );
  const snapshot: WorkspaceSnapshot = { files: new Map() };

  for (const entry of tree.tree ?? []) {
    if (entry.type !== 'blob') continue;
    const filePath = entry.path;
    const blobSha = entry.sha;
    if (filePath === undefined || blobSha === undefined) continue;
    if ((entry.size ?? 0) > MAX_BLOB_BYTES) continue;

    const blob = await githubRequest<GitHubBlobResponse>(
      token,
      `/repos/${repoRef.owner}/${repoRef.repo}/git/blobs/${blobSha}`,
    );
    if (blob.encoding !== 'base64' || blob.content === undefined) continue;

    const target = resolveWorkspacePath(dir, filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
    fs.writeFileSync(target, content);
    snapshot.files.set(normalizeRepoPath(filePath), hashBuffer(content));
  }

  const ws = {
    dir,
    branch,
    cleanup: () => {
      if (process.env.HAN_KEEP_WORKSPACE === '1') {
        console.log(`HAN_KEEP_WORKSPACE=1, keeping workspace: ${dir}`);
        return;
      }
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 500,
        });
      }
    },
  };
  snapshots.set(ws, snapshot);
  workspaceMetadata.set(ws, {
    repoRef,
    defaultBranch,
    baseCommitSha: commitSha,
    baseTreeSha: treeSha,
  });
  return ws;
}

async function commitAndPushViaGithubApi(
  ws: Workspace,
  message: string,
  token: string,
): Promise<boolean> {
  const diff = getWorkspaceDiff(ws);
  if (diff.added.length === 0 && diff.modified.length === 0 && diff.deleted.length === 0) {
    return false;
  }

  const metadata = workspaceMetadata.get(ws);
  if (metadata === undefined) {
    throw new Error('Missing github-api workspace metadata');
  }

  const treeEntries: GitHubCreateTreeEntry[] = [];
  for (const filePath of [...diff.added, ...diff.modified]) {
    const content = fs.readFileSync(resolveWorkspacePath(ws.dir, filePath));
    if (content.byteLength > MAX_BLOB_BYTES) {
      throw new Error(`File is too large for github-api publish (${content.byteLength} bytes): ${filePath}`);
    }

    const blob = await githubRequest<GitHubCreateBlobResponse>(
      token,
      `/repos/${metadata.repoRef.owner}/${metadata.repoRef.repo}/git/blobs`,
      {
        method: 'POST',
        body: {
          content: content.toString('base64'),
          encoding: 'base64',
        },
      },
    );
    treeEntries.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: requireString(blob.sha, `created blob sha for ${filePath}`),
    });
  }

  for (const filePath of diff.deleted) {
    treeEntries.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: null,
    });
  }

  const tree = await githubRequest<GitHubCreateTreeResponse>(
    token,
    `/repos/${metadata.repoRef.owner}/${metadata.repoRef.repo}/git/trees`,
    {
      method: 'POST',
      body: {
        base_tree: metadata.baseTreeSha,
        tree: treeEntries,
      },
    },
  );
  const treeSha = requireString(tree.sha, 'created tree sha');

  const commit = await githubRequest<GitHubCreateCommitResponse>(
    token,
    `/repos/${metadata.repoRef.owner}/${metadata.repoRef.repo}/git/commits`,
    {
      method: 'POST',
      body: {
        message,
        tree: treeSha,
        parents: [metadata.baseCommitSha],
      },
    },
  );
  const commitSha = requireString(commit.sha, 'created commit sha');
  await publishBranchRef(token, metadata.repoRef, ws.branch, commitSha);

  snapshots.set(ws, readWorkspaceSnapshot(ws.dir));
  workspaceMetadata.set(ws, {
    ...metadata,
    baseCommitSha: commitSha,
    baseTreeSha: treeSha,
  });

  return true;
}

async function createPullRequestViaGithubApi(
  ws: Workspace,
  title: string,
  body: string,
  token: string,
): Promise<string> {
  const metadata = workspaceMetadata.get(ws);
  if (metadata === undefined) {
    throw new Error('Missing github-api workspace metadata');
  }

  const existingPull = await findPullRequestForBranch(token, metadata.repoRef, ws.branch);
  if (existingPull !== undefined) {
    if (existingPull.state === 'open') {
      return requireString(existingPull.html_url, 'existing pull request html_url');
    }
    throw existingPullRequestClosedError(ws.branch, existingPull);
  }

  try {
    const pr = await githubRequest<GitHubCreatePullResponse>(
      token,
      `/repos/${metadata.repoRef.owner}/${metadata.repoRef.repo}/pulls`,
      {
        method: 'POST',
        body: {
          title,
          body,
          head: ws.branch,
          base: metadata.defaultBranch,
        },
      },
    );

    return requireString(pr.html_url, 'created pull request html_url');
  } catch (error) {
    const retryExistingPull = await findPullRequestForBranch(token, metadata.repoRef, ws.branch);
    if (retryExistingPull !== undefined) {
      if (retryExistingPull.state === 'open') {
        return requireString(retryExistingPull.html_url, 'existing pull request html_url');
      }
      throw existingPullRequestClosedError(ws.branch, retryExistingPull);
    }
    throw error;
  }
}

async function assertReusablePullRequestBranch(
  token: string,
  repoRef: GitHubRepoRef,
  branch: string,
): Promise<void> {
  const existingPull = await findPullRequestForBranch(token, repoRef, branch);
  if (existingPull === undefined || existingPull.state === 'open') return;
  throw existingPullRequestClosedError(branch, existingPull);
}

async function findPullRequestForBranch(
  token: string,
  repoRef: GitHubRepoRef,
  branch: string,
): Promise<GitHubPullResponse | undefined> {
  const pulls = await githubRequest<GitHubPullResponse[]>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}/pulls?state=all&head=${encodeURIComponent(`${repoRef.owner}:${branch}`)}`,
  );
  return pulls[0];
}

function existingPullRequestClosedError(branch: string, pull: GitHubPullResponse): Error {
  const url = pull.html_url ?? '(unknown PR URL)';
  const state = pull.merged_at !== null && pull.merged_at !== undefined ? 'merged' : (pull.state ?? 'closed');
  return new Error(
    `Branch ${branch} already has a ${state} pull request: ${url}. Create a new Notion task to rerun this work.`,
  );
}

async function publishBranchRef(
  token: string,
  repoRef: GitHubRepoRef,
  branch: string,
  commitSha: string,
): Promise<void> {
  const refPath = `/repos/${repoRef.owner}/${repoRef.repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const updated = await githubRequestAllowNotFound(
    token,
    refPath,
    {
      method: 'PATCH',
      body: {
        sha: commitSha,
        force: true,
      },
    },
  );

  if (updated) return;

  await githubRequest<unknown>(
    token,
    `/repos/${repoRef.owner}/${repoRef.repo}/git/refs`,
    {
      method: 'POST',
      body: {
        ref: `refs/heads/${branch}`,
        sha: commitSha,
      },
    },
  );
}

function parseGithubRepo(value: string): GitHubRepoRef {
  const normalized = value
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
  const [owner, repo] = normalized.split('/');

  if (owner === undefined || owner.length === 0 || repo === undefined || repo.length === 0) {
    throw new Error(`Invalid github_repo: ${value}`);
  }

  return { owner, repo };
}

interface GitHubRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

async function githubRequest<T>(
  token: string,
  pathOrUrl: string,
  options: GitHubRequestOptions = {},
): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GITHUB_API_URL}${pathOrUrl}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      'User-Agent': 'han-ai',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

async function githubRequestAllowNotFound(
  token: string,
  pathOrUrl: string,
  options: GitHubRequestOptions,
): Promise<boolean> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GITHUB_API_URL}${pathOrUrl}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      'User-Agent': 'han-ai',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });

  if (res.status === 404) return false;
  if (res.status === 422) {
    const text = await res.text();
    if (text.includes('Reference does not exist')) return false;
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  return true;
}

function requireString(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath.replace(/\//g, path.sep));
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error(`Unsafe repository path: ${relativePath}`);
  }
  return target;
}

function getWorkspaceDiff(ws: Workspace): WorkspaceDiff {
  const snapshot = snapshots.get(ws);
  if (snapshot === undefined) {
    throw new Error('Missing github-api workspace snapshot');
  }

  const currentFiles = readWorkspaceSnapshot(ws.dir).files;
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [filePath, hash] of currentFiles) {
    const originalHash = snapshot.files.get(filePath);
    if (originalHash === undefined) {
      added.push(filePath);
    } else if (originalHash !== hash) {
      modified.push(filePath);
    }
  }

  for (const filePath of snapshot.files.keys()) {
    if (!currentFiles.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
  };
}

function readWorkspaceSnapshot(root: string): WorkspaceSnapshot {
  const files = new Map<string, string>();
  collectWorkspaceFiles(root, root, files);
  return { files };
}

function collectWorkspaceFiles(root: string, dir: string, files: Map<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectWorkspaceFiles(root, fullPath, files);
      continue;
    }

    if (!entry.isFile()) continue;

    const relativePath = normalizeRepoPath(path.relative(root, fullPath));
    const content = fs.readFileSync(fullPath);
    files.set(relativePath, hashBuffer(content));
  }
}

function hashBuffer(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeRepoPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

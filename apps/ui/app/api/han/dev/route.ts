import { NextRequest, NextResponse } from "next/server";
import { Client as NotionClient } from "@notionhq/client";
import { CRON_SECRET, getServerConfig } from "@/lib/server-config";
import type { UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints.js";
import Redis from "ioredis";
import fs from "fs";
import path from "path";
import os from "os";
import type { TaskStatus } from "@/lib/types";
import { redisOptionsFromUrl } from "@/lib/redis-options";
import { callQwen } from "@/lib/qwen-brain";
import { callBrain } from "@/lib/call-brain";
import { createGoogleDoc, createGoogleSheet, createGoogleSlides } from "@/lib/google-drive";
import { runTestsInSandbox } from "@/lib/vercel-sandbox-runner";
import {
  detectTestCommand,
  detectInstallCommand,
  detectTestFramework,
} from "@/lib/test-detector";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const GITHUB_API = "https://api.github.com";
const WS_DIR = path.join(os.tmpdir(), "han-ws");
const MAX_FILE_BYTES = 100_000;
const MAX_FILES = 200;
const MAX_CONTEXT_CHARS = 40_000;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);
const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

const CODE_GEN_SYSTEM = `You are Han AI — an autonomous dev agent.
Return only valid JSON with this shape:
{
  "summary": "Short summary of the change",
  "files": [
    { "path": "relative/path/to/file.ts", "action": "upsert", "content": "Complete file content" },
    { "path": "relative/path/to/deleted.ts", "action": "delete" }
  ]
}
Rules:
- Return JSON only. No markdown, no explanation.
- Use relative repository paths only.
- Do not modify node_modules, .git, or lockfiles.
- Keep changes scoped to the task.`;

function buildSystemPrompt(type: string): string {
  switch (type) {
    case 'dev':
      return CODE_GEN_SYSTEM;
    case 'doc':
      return `You are Han AI — an autonomous document writer.
Return only valid JSON with this shape:
{
  "summary": "Short summary of the document",
  "files": [
    { "path": "relative/path/to/document.md", "action": "upsert", "content": "Complete document content" }
  ]
}
Rules:
- Return JSON only. No markdown wrapper, no explanation.
- Write in Thai or English based on the task title language.
- Structure the document clearly with headings and sections.`;
    case 'sheet':
      return `You are Han AI — an autonomous spreadsheet creator.
Return only valid JSON with this shape:
{
  "summary": "Short summary of the spreadsheet",
  "files": [
    { "path": "relative/path/to/spreadsheet.csv", "action": "upsert", "content": "CSV content with headers and rows" }
  ]
}
Rules:
- Return JSON only. No markdown wrapper, no explanation.
- Use CSV format with comma separation.
- Include headers in the first row.`;
    case 'slide':
      return `You are Han AI — an autonomous presentation creator.
Return only valid JSON with this shape:
{
  "summary": "Short summary of the presentation",
  "files": [
    { "path": "relative/path/to/slides.md", "action": "upsert", "content": "Slide content in markdown" }
  ]
}
Rules:
- Return JSON only. No markdown wrapper, no explanation.
- Use --- to separate slides.
- Each slide should have a title and bullet points.`;
    default:
      return CODE_GEN_SYSTEM;
  }
}

function buildUserPrompt(title: string, context?: string): string {
  return [
    `Task: ${title}`,
    context ? `\nContext:\n${context}` : '',
  ].join('');
}

const TEST_GEN_SYSTEM = `You are Han AI — a test writer.
Return only valid JSON with this exact shape:
{
  "files": [
    { "path": "relative/path/to/file.test.ts", "action": "upsert", "content": "Complete test file content" }
  ]
}
Rules:
- Return JSON only. No markdown, no explanation.
- Write unit tests for the changed files only.
- Use relative repository paths.
- Match the test framework already in use.`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DevRequest {
  task: {
    id: string;
    notion_page_id: string;
    title: string;
    type: string;
    retry_count: number;
    context?: string;
  };
  project: {
    notion_db_id: string;
    github_repo: string;
    github_token?: string;
    google_drive_folder_id?: string;
  };
  lockKey: string;
}

interface FileChange {
  path: string;
  action: "upsert" | "delete";
  content?: string;
}

interface CodeGenOutput {
  summary: string;
  files: FileChange[];
}

interface TestGenOutput {
  files: FileChange[];
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function ghRequest<T>(
  token: string,
  endpoint: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${GITHUB_API}${endpoint}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "han-ai",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function parseRepo(githubRepo: string): { owner: string; repo: string } {
  const clean = githubRepo
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/|\/$/g, "");
  const [owner, repo] = clean.split("/");
  if (!owner || !repo) throw new Error(`Invalid github_repo: ${githubRepo}`);
  return { owner, repo };
}

function shouldSkipPath(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

async function downloadWorkspace(
  token: string,
  githubRepo: string,
  taskId: string,
): Promise<{
  dir: string;
  files: Map<string, string>;
  fileTree: string[];
  commitSha: string;
  treeSha: string;
  defaultBranch: string;
}> {
  const { owner, repo } = parseRepo(githubRepo);

  const repoInfo = await ghRequest<{ default_branch: string }>(
    token,
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch ?? "main";

  const refData = await ghRequest<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
  );
  const commitSha = refData.object.sha;

  const commitData = await ghRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${commitSha}`,
  );
  const treeSha = commitData.tree.sha;

  const treeData = await ghRequest<{
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
  }>(token, `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);

  const dir = path.join(WS_DIR, taskId);
  fs.mkdirSync(dir, { recursive: true });

  const files = new Map<string, string>();
  const fileTree: string[] = [];
  let downloaded = 0;

  for (const entry of treeData.tree) {
    if (entry.type !== "blob" || !entry.path) continue;
    fileTree.push(entry.path);
    if (shouldSkipPath(entry.path)) continue;
    if ((entry.size ?? 0) > MAX_FILE_BYTES) continue;
    if (downloaded >= MAX_FILES) continue;

    const blob = await ghRequest<{ content: string; encoding: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs/${entry.sha}`,
    );
    if (blob.encoding !== "base64") continue;

    const content = Buffer.from(
      blob.content.replace(/\s/g, ""),
      "base64",
    ).toString("utf8");
    const target = path.resolve(dir, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    files.set(entry.path, content);
    downloaded++;
  }

  return { dir, files, fileTree, commitSha, treeSha, defaultBranch };
}

function buildContext(files: Map<string, string>, fileTree: string[]): string {
  const SRC_RE = [
    /^src\//,
    /^lib\//,
    /^app\//,
    /^pages\//,
    /^components\//,
    /^utils\//,
    /^api\//,
  ];
  let context = "";
  for (const filePath of fileTree) {
    if (!SRC_RE.some((re) => re.test(filePath))) continue;
    if (shouldSkipPath(filePath)) continue;
    const content = files.get(filePath);
    if (!content) continue;
    const chunk = `\n=== ${filePath} ===\n${content}\n`;
    if (context.length + chunk.length > MAX_CONTEXT_CHARS) break;
    context += chunk;
  }
  return context;
}

async function commitAndCreatePR(
  token: string,
  githubRepo: string,
  branch: string,
  baseCommitSha: string,
  baseTreeSha: string,
  defaultBranch: string,
  changedFiles: Map<string, string | null>,
  title: string,
  body: string,
): Promise<string> {
  const { owner, repo } = parseRepo(githubRepo);

  const treeEntries: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string | null;
  }> = [];
  for (const [filePath, content] of changedFiles) {
    if (content === null) {
      treeEntries.push({
        path: filePath,
        mode: "100644",
        type: "blob",
        sha: null,
      });
      continue;
    }
    const blob = await ghRequest<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs`,
      {
        method: "POST",
        body: {
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
        },
      },
    );
    treeEntries.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await ghRequest<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      body: { base_tree: baseTreeSha, tree: treeEntries },
    },
  );

  const commit = await ghRequest<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      body: {
        message: `han: ${title}`,
        tree: tree.sha,
        parents: [baseCommitSha],
      },
    },
  );

  // create or update branch ref — try POST first, PATCH if branch already exists
  try {
    await ghRequest(token, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  } catch {
    // branch already exists — force-update it
    await ghRequest(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: true },
    });
  }

  let prUrl: string;
  try {
    const pr = await ghRequest<{ html_url: string }>(
      token,
      `/repos/${owner}/${repo}/pulls`,
      {
        method: "POST",
        body: {
          title: `Han AI: ${title}`,
          body,
          head: branch,
          base: defaultBranch,
        },
      },
    );
    prUrl = pr.html_url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already exists')) throw err;
    // PR already exists — find and return its URL
    const existing = await ghRequest<Array<{ html_url: string }>>(
      token,
      `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
    );
    if (!existing[0]?.html_url) throw new Error(`PR already exists but could not retrieve URL: ${msg}`);
    prUrl = existing[0].html_url;
  }
  return prUrl;
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function stripJsonFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return m?.[1]?.trim() ?? text.trim();
}

// Repair Qwen JSON output: escape unescaped control chars and inner quotes.
// Tracks key-vs-value context so "key": inside a content value is not mistaken for a terminator.
function repairJsonStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  // Each stack frame: type '{' or '[', expectKey true when next string is an object key
  const stack: Array<{ type: '{' | '['; expectKey: boolean }> = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        const ctx = stack[stack.length - 1];
        const isKey = ctx?.type === '{' && ctx.expectKey;
        // Keys close on ':', values close on ',', '}', ']', or EOF
        let j = i + 1;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
        const next = text[j] ?? '';
        const isTerminator = isKey
          ? (next === ':' || j >= text.length)
          : (next === ',' || next === '}' || next === ']' || j >= text.length);

        if (isTerminator) {
          inString = false;
          result += ch;
          if (ctx && isKey) ctx.expectKey = false;
        } else {
          result += '\\"';
        }
      }
      continue;
    }

    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    } else {
      if (ch === '{') {
        stack.push({ type: '{', expectKey: true });
      } else if (ch === '[') {
        stack.push({ type: '[', expectKey: false });
      } else if (ch === '}' || ch === ']') {
        stack.pop();
      } else if (ch === ':') {
        const ctx = stack[stack.length - 1];
        if (ctx?.type === '{') ctx.expectKey = false;
      } else if (ch === ',') {
        const ctx = stack[stack.length - 1];
        if (ctx?.type === '{') ctx.expectKey = true;
      }
    }
    result += ch;
  }

  // Close truncated output
  if (inString) result += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    result += stack[i]?.type === '{' ? '}' : ']';
  }
  return result;
}

// Quote unquoted property names: { key: ... } → { "key": ... }
// Only applies outside of string values.
function repairUnquotedKeys(text: string): string {
  return text.replace(/([{,]\s*)([A-Za-z_-￿][A-Za-z0-9_-￿]*)(\s*:)/g, (_, pre, key, post) => {
    // Skip if key is already inside a quoted string context (heuristic: no preceding ")
    return `${pre}"${key}"${post}`;
  });
}

function parseJson(text: string): unknown {
  const stripped = stripJsonFence(text);
  // Try 1: as-is
  try { return JSON.parse(stripped); } catch { /* continue */ }
  // Try 2: repair literal newlines/tabs inside strings
  const repaired = repairJsonStrings(stripped);
  try { return JSON.parse(repaired); } catch { /* continue */ }
  // Try 3: also quote unquoted property names
  return JSON.parse(repairUnquotedKeys(repaired));
}

const UPSERT_ALIASES = new Set(['upsert', 'create', 'update', 'write', 'modify', 'add', 'insert', 'put'])
const DELETE_ALIASES = new Set(['delete', 'remove', 'rm', 'del'])
const SKIP_ALIASES = new Set(['skip', 'none', 'no-op', 'noop', 'ignore', 'keep'])

function normalizeAction(raw: unknown): 'upsert' | 'delete' | 'skip' | null {
  if (typeof raw !== 'string') return null
  const v = raw.toLowerCase().trim()
  if (UPSERT_ALIASES.has(v)) return 'upsert'
  if (DELETE_ALIASES.has(v)) return 'delete'
  if (SKIP_ALIASES.has(v)) return 'skip'
  return null
}

function parseFileChange(value: unknown, index: number): FileChange | null {
  const f = value as { path?: unknown; action?: unknown; content?: unknown };
  if (typeof f.path !== "string" || f.path.trim().length === 0)
    throw new Error(`files[${index}].path invalid`);
  const action = normalizeAction(f.action)
  if (action === 'skip') return null
  if (!action)
    throw new Error(`files[${index}].action invalid (got: ${String(f.action)})`);
  const filePath = f.path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return {
    path: filePath,
    action,
    ...(action === "upsert" && typeof f.content === "string"
      ? { content: f.content }
      : {}),
  };
}

function parseCodeGenOutput(text: string): CodeGenOutput {
  const raw = parseJson(text) as {
    summary?: unknown;
    files?: unknown;
  };
  if (typeof raw.summary !== "string")
    throw new Error("Missing summary in code gen output");
  if (!Array.isArray(raw.files))
    throw new Error("Missing files array in code gen output");
  return { summary: raw.summary.trim(), files: raw.files.map(parseFileChange).filter((f): f is FileChange => f !== null) };
}

function parseTestGenOutput(text: string): TestGenOutput {
  const raw = parseJson(text) as { files?: unknown };
  if (!Array.isArray(raw.files))
    throw new Error("Missing files array in test gen output");
  return { files: raw.files.map(parseFileChange).filter((f): f is FileChange => f !== null) };
}

function applyChanges(
  dir: string,
  changes: FileChange[],
): Map<string, string | null> {
  const changed = new Map<string, string | null>();
  const root = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
  for (const change of changes) {
    const target = path.resolve(dir, change.path);
    if (target !== dir && !target.startsWith(root)) continue;
    if (change.action === "delete") {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      changed.set(change.path, null);
    } else if (change.content !== undefined) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, change.content, "utf8");
      changed.set(change.path, change.content);
    }
  }
  return changed;
}

// ─── Notion helpers ───────────────────────────────────────────────────────────

async function updateNotionStatus(
  notion: NotionClient,
  pageId: string,
  status: TaskStatus,
  extra: {
    output_url?: string;
    error_log?: string | null;
    brain_used?: string;
    retry_count?: number;
  },
): Promise<void> {
  const props: UpdatePageParameters["properties"] = {
    status: { select: { name: status } },
  };
  if (extra.output_url !== undefined)
    props["output_url"] = { url: extra.output_url };
  if (extra.error_log !== undefined) {
    props["error_log"] =
      extra.error_log === null
        ? { rich_text: [] }
        : {
            rich_text: [
              {
                type: "text",
                text: { content: extra.error_log.slice(0, 2000) },
              },
            ],
          };
  }
  if (extra.brain_used !== undefined)
    props["brain_used"] = { select: { name: extra.brain_used } };
  if (extra.retry_count !== undefined)
    props["retry_count"] = { number: extra.retry_count };
  await notion.pages.update({ page_id: pageId, properties: props });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = CRON_SECRET;
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    NOTION_TOKEN: notionToken,
    REDIS_URL: redisUrl,
    GITHUB_TOKEN,
    HAN_MACHINE_ID,
    HAN_BRAIN,
  } = await getServerConfig();

  let body: DevRequest;
  try {
    body = (await request.json()) as DevRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const githubToken = body.project.github_token ?? GITHUB_TOKEN;

  const { task, project, lockKey } = body;
  const machineId = HAN_MACHINE_ID;
  const notion = new NotionClient({ auth: notionToken });
  const redis = new Redis(redisOptionsFromUrl(redisUrl));
  const branch = `han/${task.id.slice(0, 8)}`;
  let workspaceDir: string | undefined;

  const releaseLock = async (): Promise<void> => {
    try {
      const owner = await redis.get(lockKey);
      if (owner === machineId) await redis.del(lockKey);
    } catch {
      // ignore
    } finally {
      await redis.quit();
    }
  };

  try {
    // ── DOC / SHEET / SLIDE flow (Google Drive) ───────────────────────────────
    if (task.type === 'doc' || task.type === 'sheet' || task.type === 'slide') {
      const folderId = project.google_drive_folder_id
      if (!folderId) throw new Error('google_drive_folder_id not configured for this project')

      console.log(`[han/dev] ${task.id} step G.1: qwen content gen (type=${task.type})`)
      const systemPrompt = buildSystemPrompt(task.type)
      const userPrompt = buildUserPrompt(task.title, task.context)
      const contentText = await callQwen(systemPrompt, userPrompt)
      const contentGen = parseCodeGenOutput(contentText)
      const firstFile = contentGen.files.find(f => f.action === 'upsert' && f.content !== undefined)
      if (!firstFile?.content) throw new Error('Qwen returned no content for task')

      console.log(`[han/dev] ${task.id} step G.2: create Google ${task.type}`)
      let outputUrl: string
      if (task.type === 'doc') {
        outputUrl = await createGoogleDoc(folderId, task.title, firstFile.content)
      } else if (task.type === 'sheet') {
        outputUrl = await createGoogleSheet(folderId, task.title, firstFile.content)
      } else {
        outputUrl = await createGoogleSlides(folderId, task.title, firstFile.content)
      }

      console.log(`[han/dev] ${task.id} step G.3: done -> ${outputUrl}`)
      await updateNotionStatus(notion, task.notion_page_id, 'Done', {
        output_url: outputUrl,
        brain_used: 'qwen-runpod',
        error_log: null,
      })
      await releaseLock()
      return NextResponse.json({ status: 'done', task_id: task.id, output_url: outputUrl })
    }

    // ── STEP 1.1: Download source ────────────────────────────────────────────
    console.log(
      `[han/dev] ${task.id} step 1.1: downloading ${project.github_repo}`,
    );
    const ws = await downloadWorkspace(
      githubToken,
      project.github_repo,
      task.id,
    );
    workspaceDir = ws.dir;

    // ── STEP 1.2: Generate code changes (Qwen on RunPod) ─────────────────────
    console.log(`[han/dev] ${task.id} step 1.2: qwen code gen (type=${task.type})`);
    const systemPrompt = buildSystemPrompt(task.type);
    const codeGenUser = [
      buildUserPrompt(task.title, task.context),
      `\nFile tree:\n${ws.fileTree.join("\n")}`,
      `\nKey file contents:${buildContext(ws.files, ws.fileTree)}`,
    ].join("");

    const codeGenText = await callQwen(systemPrompt, codeGenUser);
    const codeGen = parseCodeGenOutput(codeGenText);
    const changedByCode = applyChanges(ws.dir, codeGen.files);

    // ── STEP 1.3: Generate unit tests (callBrain on Vercel) ───────────────────
    console.log(`[han/dev] ${task.id} step 1.3: brain test gen`);
    const framework = detectTestFramework(ws.fileTree);
    const testGenUser = [
      `Changed files:\n${codeGen.files.map((f) => `${f.action}: ${f.path}`).join("\n")}`,
      `\nSummary: ${codeGen.summary}`,
      `\nTest framework: ${framework}`,
      `\nChanged file contents:`,
      ...codeGen.files
        .filter((f) => f.action === "upsert" && f.content)
        .map((f) => `\n=== ${f.path} ===\n${(f.content ?? "").slice(0, 3000)}`),
    ].join("");

    const testGenText = await callBrain(TEST_GEN_SYSTEM, testGenUser);
    const testGen = parseTestGenOutput(testGenText);
    const changedByTests = applyChanges(ws.dir, testGen.files);

    // ── STEP 1.4: Run tests (Vercel Sandbox) ─────────────────────────────────
    console.log(`[han/dev] ${task.id} step 1.4: run tests`);
    const allFiles: Record<string, string> = {};
    for (const [p, c] of ws.files) allFiles[p] = c;
    for (const [p, c] of changedByCode) {
      if (c !== null) allFiles[p] = c;
      else delete allFiles[p];
    }
    for (const [p, c] of changedByTests) {
      if (c !== null) allFiles[p] = c;
    }

    const testResult = await runTestsInSandbox(
      task.id,
      allFiles,
      detectInstallCommand(ws.fileTree),
      detectTestCommand(ws.fileTree),
    );

    // ── STEP 1.5: Commit & PR (GitHub API) ───────────────────────────────────
    console.log(`[han/dev] ${task.id} step 1.5: create PR`);
    const allChanges = new Map<string, string | null>([
      ...changedByCode,
      ...changedByTests,
    ]);
    const testEmoji = testResult.exitCode === 0 ? "✅" : "⚠️";
    const prBody = [
      `## Summary\n${codeGen.summary}`,
      `\n## Test Results\n${testEmoji} ${testResult.passed} passed / ${testResult.failed} failed`,
      `\n\`\`\`\n${testResult.output.slice(0, 3000)}\n\`\`\``,
      `\n---\n🤖 Han AI | code: qwen3-max | tests: ${HAN_BRAIN} | task: ${task.id}`,
    ].join("");

    const prUrl = await commitAndCreatePR(
      githubToken,
      project.github_repo,
      branch,
      ws.commitSha,
      ws.treeSha,
      ws.defaultBranch,
      allChanges,
      task.title,
      prBody,
    );

    // ── STEP 1.6: Update Notion → Done ────────────────────────────────────────
    console.log(`[han/dev] ${task.id} step 1.6: done -> ${prUrl}`);
    await updateNotionStatus(notion, task.notion_page_id, "Done", {
      output_url: prUrl,
      brain_used: "qwen3-max",
      error_log: null,
    });

    return NextResponse.json({
      status: "done",
      task_id: task.id,
      pr_url: prUrl,
      test_passed: testResult.passed,
      test_failed: testResult.failed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[han/dev] ${task.id} failed: ${message}`);

    const retryCount = task.retry_count + 1;
    const newStatus: TaskStatus = retryCount >= 3 ? "Failed" : "Approve";
    try {
      await updateNotionStatus(notion, task.notion_page_id, newStatus, {
        error_log: message,
        retry_count: retryCount,
      });
    } catch {
      // ignore notion update error
    }

    return NextResponse.json(
      { status: "failed", task_id: task.id, error: message },
      { status: 500 },
    );
  } finally {
    if (workspaceDir) {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    await releaseLock();
  }
}

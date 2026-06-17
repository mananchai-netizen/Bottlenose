import { FatalError, RetryableError, getWritable } from 'workflow'
import { DurableAgent } from '@workflow/ai/agent'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import type { UIMessageChunk } from 'ai'
import { runTestsInSandbox } from '@/lib/vercel-sandbox-runner'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DevWorkflowInput {
  taskId: string
  taskTitle: string
  taskContext: string | undefined
  notionPageId: string
  githubRepo: string
  githubToken: string | undefined
  notionToken: string
  redisUrl: string
  lockKey: string
  machineId: string
  appUrl: string
  cronSecret: string
  qwenUrl?: string
  qwenToken?: string
  qwenModel?: string
}

interface FileChange {
  path: string
  action: 'upsert' | 'delete'
  content?: string
}

const GITHUB_API = 'https://api.github.com'

const CODE_GEN_SYSTEM = `You are Han AI — an autonomous dev agent.
Analyze the repository and implement the requested task.
Use read_file to understand existing code before making changes.
Use edit_file to apply changes.
Use run_tests to verify your changes work.
If tests fail, fix the issues and run tests again (max 3 attempts).
When done, call finish with a summary.

CRITICAL: When calling tools, ALL arguments MUST be valid JSON with double quotes only.
- NEVER use backticks (\`) or single quotes (') in tool arguments
- NEVER use JavaScript template literals in JSON
- File content in edit_file must use double quotes and escape newlines as \\n
- Example correct: {"path": "src/foo.ts", "content": "export default function() {}"}
- Example WRONG: {"path": "src/foo.ts", "content": \`export default function() {}\`}`

// ─── Steps ────────────────────────────────────────────────────────────────────

async function ghRequest<T>(token: string, url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  'use step'
  const fullUrl = url.startsWith('http') ? url : `${GITHUB_API}${url}`
  const res = await fetch(fullUrl, {
    method: opts.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'bottlenose-ai',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  })
  if (!res.ok) {
    const body = await res.text()
    // 4xx client errors (except 429 rate limit) are not retryable
    if (res.status !== 429 && res.status >= 400 && res.status < 500) {
      throw new FatalError(`GitHub API ${res.status}: ${body}`)
    }
    throw new RetryableError(`GitHub API ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function downloadRepo(githubRepo: string, token: string, taskId: string) {
  'use step'
  const clean = githubRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/|\/$/g, '')
  const [owner, repo] = clean.split('/')
  if (!owner || !repo) throw new FatalError(`Invalid github_repo: ${githubRepo}`)

  const repoInfo = await ghRequest<{ default_branch: string }>(token, `/repos/${owner}/${repo}`)
  const refData = await ghRequest<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/ref/heads/${repoInfo.default_branch}`)
  const commitData = await ghRequest<{ tree: { sha: string } }>(token, `/repos/${owner}/${repo}/git/commits/${refData.object.sha}`)
  const treeData = await ghRequest<{ tree: Array<{ path: string; type: string; sha: string; size?: number }> }>(
    token, `/repos/${owner}/${repo}/git/trees/${commitData.tree.sha}?recursive=1`,
  )

  const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build'])
  const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.woff', '.ttf'])

  const files: Record<string, string> = {}
  const fileTree = treeData.tree.filter((e) => e.type === 'blob' && e.path).map((e) => e.path)
  let downloaded = 0

  for (const entry of treeData.tree) {
    if (entry.type !== 'blob' || !entry.path) continue
    const parts = entry.path.split('/')
    if (parts.some((p) => IGNORED.has(p))) continue
    if (BINARY.has(entry.path.slice(entry.path.lastIndexOf('.')).toLowerCase())) continue
    if ((entry.size ?? 0) > 100_000 || downloaded >= 200) continue

    const blob = await ghRequest<{ content: string; encoding: string }>(token, `/repos/${owner}/${repo}/git/blobs/${entry.sha}`)
    if (blob.encoding === 'base64') {
      files[entry.path] = Buffer.from(blob.content.replace(/\s/g, ''), 'base64').toString('utf8')
      downloaded++
    }
  }

  return { owner, repo, files, fileTree, commitSha: refData.object.sha, treeSha: commitData.tree.sha, defaultBranch: repoInfo.default_branch, taskId }
}

async function createPR(
  token: string, owner: string, repo: string,
  branch: string, baseCommitSha: string, baseTreeSha: string, defaultBranch: string,
  changes: Record<string, string | null>, title: string, body: string,
) {
  'use step'
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = []
  for (const [filePath, content] of Object.entries(changes)) {
    if (content === null) {
      treeEntries.push({ path: filePath, mode: '100644', type: 'blob', sha: null })
    } else {
      const blob = await ghRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST', body: { content: Buffer.from(content).toString('base64'), encoding: 'base64' },
      })
      treeEntries.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha })
    }
  }

  const tree = await ghRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST', body: { base_tree: baseTreeSha, tree: treeEntries },
  })
  const commit = await ghRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST', body: { message: `han: ${title}`, tree: tree.sha, parents: [baseCommitSha] },
  })

  const refUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`
  const patchRes = await fetch(refUrl, {
    method: 'PATCH',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'bottlenose-ai', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ sha: commit.sha, force: true }),
  })
  if (patchRes.status === 404) {
    await ghRequest(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    })
  }

  const pr = await ghRequest<{ html_url: string }>(token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST', body: { title: `Han AI: ${title}`, body, head: branch, base: defaultBranch },
  })
  return pr.html_url
}

async function updateNotion(notionToken: string, pageId: string, status: string, extra: { output_url?: string; error_log?: string; brain_used?: string; retry_count?: number }) {
  'use step'
  const props: Record<string, unknown> = { status: { select: { name: status } } }
  if (extra.output_url) props['output_url'] = { url: extra.output_url }
  if (extra.error_log) props['error_log'] = { rich_text: [{ type: 'text', text: { content: extra.error_log.slice(0, 2000) } }] }
  if (extra.brain_used) props['brain_used'] = { select: { name: extra.brain_used } }
  if (extra.retry_count !== undefined) props['retry_count'] = { number: extra.retry_count }
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${notionToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ properties: props }),
  })
}

// ─── Model resolver ───────────────────────────────────────────────────────────

function resolveModel(
  qwenUrl: string,
  qwenToken: string,
  qwenModel: string,
): string | (() => Promise<import('@workflow/ai/agent').CompatibleLanguageModel>) | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic/claude-sonnet-4-6'
  if (qwenUrl && qwenToken) {
    return async () => {
      'use step'
      const qwen = createOpenAICompatible({
        name: 'qwen',
        baseURL: qwenUrl,
        headers: { Authorization: `Bearer ${qwenToken}` },
      })
      return qwen(qwenModel) as import('@workflow/ai/agent').CompatibleLanguageModel
    }
  }
  return null
}

// ─── Main Workflow ─────────────────────────────────────────────────────────────

export async function devWorkflow(input: DevWorkflowInput) {
  'use workflow'

  const githubToken = input.githubToken ?? ''
  const branch = `han/${input.taskId.slice(0, 8)}`

  // Step 1 — Download repo
  const ws = await downloadRepo(input.githubRepo, githubToken, input.taskId)

  // Step 2 — DurableAgent: analyze + generate code + self-correct
  const stagedChanges: Record<string, string | null> = {}

  const agentModel = resolveModel(input.qwenUrl ?? '', input.qwenToken ?? '', input.qwenModel ?? '')
  if (agentModel) {
    const agent = new DurableAgent({
      model: agentModel,
      instructions: CODE_GEN_SYSTEM,
      tools: {
        read_file: {
          description: 'อ่านเนื้อหาไฟล์จาก repo',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => {
            'use step'
            return ws.files[path] ?? `File not found: ${path}`
          },
        },
        list_files: {
          description: 'แสดง file tree ของ repo',
          inputSchema: z.object({ pattern: z.string().optional() }),
          execute: async ({ pattern }: { pattern?: string }) => {
            'use step'
            const files = pattern
              ? ws.fileTree.filter((f) => f.includes(pattern))
              : ws.fileTree
            return files.join('\n')
          },
        },
        edit_file: {
          description: 'แก้ไขหรือสร้างไฟล์',
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ path, content }: { path: string; content: string }) => {
            'use step'
            stagedChanges[path] = content
            return `Staged: ${path}`
          },
        },
        delete_file: {
          description: 'ลบไฟล์',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => {
            'use step'
            stagedChanges[path] = null
            return `Staged delete: ${path}`
          },
        },
        run_tests: {
          description: 'รัน test suite เพื่อตรวจสอบความถูกต้อง',
          inputSchema: z.object({}),
          execute: async () => {
            'use step'
            const allFiles = { ...ws.files }
            for (const [p, c] of Object.entries(stagedChanges)) {
              if (c === null) delete allFiles[p]
              else allFiles[p] = c
            }
            const result = await runTestsInSandbox(
              input.taskId,
              allFiles,
              'npm install',
              'npm test',
            )
            return `Tests: ${result.passed} passed, ${result.failed} failed\n${result.output}`
          },
        },
      },
    })

    await agent.stream({
      messages: [{ role: 'user', content: `Task: ${input.taskTitle}${input.taskContext ? `\nContext: ${input.taskContext}` : ''}\n\nFile tree:\n${ws.fileTree.slice(0, 100).join('\n')}` }],
      writable: getWritable<UIMessageChunk>(),
      maxSteps: 15,
      experimental_repairToolCall: async ({ toolCall }) => {
        try {
          let s = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input)
          // Replace backtick strings (including multiline) with double-quoted strings
          s = s.replace(/`([\s\S]*?)`/g, (_, inner) => JSON.stringify(inner))
          // Replace single-quoted strings with double-quoted strings
          s = s.replace(/'([\s\S]*?)'/g, (_, inner) => JSON.stringify(inner))
          // Quote unquoted keys
          s = s.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
          JSON.parse(s) // validate — throws if still broken
          return { ...toolCall, input: s }
        } catch {
          return null
        }
      },
    })
  }

  // Step 3 — Create PR
  if (Object.keys(stagedChanges).length === 0) {
    await updateNotion(input.notionToken, input.notionPageId, 'Failed', { error_log: 'Agent made no changes' })
    return { status: 'failed', error: 'no changes' }
  }

  const prUrl = await createPR(
    githubToken, ws.owner, ws.repo,
    branch, ws.commitSha, ws.treeSha, ws.defaultBranch,
    stagedChanges, input.taskTitle,
    `## Summary\nGenerated by Han AI\n\n---\n🤖 Han AI | task: ${input.taskId}`,
  )

  // Step 4 — Update Notion
  await updateNotion(input.notionToken, input.notionPageId, 'Done', {
    output_url: prUrl,
    brain_used: 'claude-sonnet-4-6',
  })

  return { status: 'done', pr_url: prUrl }
}

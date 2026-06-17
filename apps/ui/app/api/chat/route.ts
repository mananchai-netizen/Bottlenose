import { streamText, convertToModelMessages, type UIMessage, type ToolSet, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { NextRequest } from 'next/server'
import Redis from 'ioredis'
import { z } from 'zod'
import { start, getRun } from 'workflow/api'
import { getProjects } from '@/lib/config'
import { CRON_SECRET, APP_URL, getServerConfig } from '@/lib/server-config'
import { redisOptionsFromUrl } from '@/lib/redis-options'
import { devWorkflow } from '@/lib/workflows/dev-workflow'

export const runtime = 'nodejs'
export const maxDuration = 60

const REPO_CONTEXT_TTL = 60 * 10

const MAX_FILES = 150
const MAX_CONTEXT_CHARS = 50_000
const MAX_FILE_BYTES = 80_000
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage'])
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.woff', '.woff2', '.ttf'])
const SRC_RE = [/^src\//, /^lib\//, /^app\//, /^pages\//, /^components\//, /^utils\//, /^api\//, /^hooks\//]

function shouldSkip(p: string): boolean {
  const parts = p.split('/')
  if (parts.some((s) => IGNORED_DIRS.has(s))) return true
  return BINARY_EXTS.has(p.slice(p.lastIndexOf('.')).toLowerCase())
}

async function ghGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'bottlenose-ai',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function loadRepoContext(githubRepo: string, token: string): Promise<string> {
  const clean = githubRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/|\/$/g, '')
  const [owner, repo] = clean.split('/')
  if (!owner || !repo) throw new Error(`Invalid github_repo: ${githubRepo}`)

  const repoInfo = await ghGet<{ default_branch: string }>(token, `/repos/${owner}/${repo}`)
  const refData = await ghGet<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/ref/heads/${repoInfo.default_branch}`)
  const commitData = await ghGet<{ tree: { sha: string } }>(token, `/repos/${owner}/${repo}/git/commits/${refData.object.sha}`)
  const treeData = await ghGet<{ tree: Array<{ path: string; type: string; sha: string; size?: number }> }>(
    token, `/repos/${owner}/${repo}/git/trees/${commitData.tree.sha}?recursive=1`,
  )

  const fileTree = treeData.tree.filter((e) => e.type === 'blob' && e.path).map((e) => e.path)
  let context = `Repository: ${owner}/${repo}\nBranch: ${repoInfo.default_branch}\n\nFile tree:\n${fileTree.join('\n')}\n\nKey file contents:\n`
  let downloaded = 0

  for (const entry of treeData.tree) {
    if (entry.type !== 'blob' || !entry.path) continue
    if (!SRC_RE.some((re) => re.test(entry.path))) continue
    if (shouldSkip(entry.path)) continue
    if ((entry.size ?? 0) > MAX_FILE_BYTES) continue
    if (downloaded >= MAX_FILES) break
    if (context.length > MAX_CONTEXT_CHARS) break

    const blob = await ghGet<{ content: string; encoding: string }>(token, `/repos/${owner}/${repo}/git/blobs/${entry.sha}`)
    if (blob.encoding !== 'base64') continue
    context += `\n=== ${entry.path} ===\n${Buffer.from(blob.content.replace(/\s/g, ''), 'base64').toString('utf8')}\n`
    downloaded++
  }

  return context
}

export async function POST(req: NextRequest) {
  const { messages, projectId } = (await req.json()) as {
    messages: UIMessage[]
    projectId: string
  }

  const cfg = await getServerConfig()
  const { GITHUB_TOKEN, REDIS_URL, QWEN_RUNPOD_URL, QWEN_RUNPOD_TOKEN, QWEN_MODEL_NAME, NOTION_TOKEN, HAN_MACHINE_ID } = cfg

  const projects = await getProjects()
  const project = projects.find((p) => p.project_id === projectId)
  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  const githubToken = project.github_token ?? GITHUB_TOKEN
  const hasRepo = !!(project.github_repo && githubToken)

  let systemPrompt = `CRITICAL RULE: You MUST respond in Thai (ภาษาไทย) or English ONLY. NEVER use Chinese characters. If the user writes Thai, respond in Thai. If English, respond in English. This rule overrides everything else.

You are Bottlenose AI — a senior developer assistant for the "${project.project_name}" project.

Your capabilities:
- Discuss code, explain architecture, suggest improvements
- When user wants code changes: summarize what you'll do FIRST, then call apply_changes only after user confirms
- After apply_changes: report the PR URL and run ID
- Use check_pr_status to check if a previous PR is ready

Rules:
- Always explain the plan before applying changes
- Never apply changes without user confirmation`

  if (project.github_repo && githubToken) {
    try {
      let repoContext: string | null = null

      if (REDIS_URL) {
        const redis = new Redis(redisOptionsFromUrl(REDIS_URL))
        try {
          const cacheKey = `repo:context:${project.project_id}`
          repoContext = await redis.get(cacheKey)
          if (!repoContext) {
            repoContext = await loadRepoContext(project.github_repo, githubToken)
            await redis.setex(cacheKey, REPO_CONTEXT_TTL, repoContext)
          }
        } finally {
          await redis.quit()
        }
      } else {
        repoContext = await loadRepoContext(project.github_repo, githubToken)
      }

      systemPrompt += `\n\n${repoContext}`
    } catch {
      systemPrompt += `\n\nNote: Could not load repo context.`
    }
  }

  // ─── Tools ────────────────────────────────────────────────────────────────

  const tools: ToolSet = {
    apply_changes: {
      description: 'Trigger the dev workflow to apply code changes and create a GitHub PR. Only call this after user explicitly confirms.',
      inputSchema: z.object({
        task_title: z.string().describe('Short title for the task / PR title'),
        task_context: z.string().optional().describe('Detailed description of what to change and why'),
      }),
      execute: async (input: unknown) => {
        const { task_title, task_context } = input as { task_title: string; task_context?: string }
        if (!hasRepo) return { error: 'No GitHub repo or token configured for this project' }
        try {
          const run = await start(devWorkflow, [{
            taskId: `chat-${Date.now()}`,
            taskTitle: task_title,
            taskContext: task_context,
            notionPageId: 'chat-triggered',
            githubRepo: project.github_repo!,
            githubToken: githubToken || undefined,
            notionToken: NOTION_TOKEN,
            redisUrl: REDIS_URL,
            lockKey: `chat:${projectId}:lock`,
            machineId: HAN_MACHINE_ID,
            appUrl: APP_URL,
            cronSecret: CRON_SECRET,
            qwenUrl: QWEN_RUNPOD_URL,
            qwenToken: QWEN_RUNPOD_TOKEN,
            qwenModel: QWEN_MODEL_NAME,
          }])
          return { status: 'started', runId: run.runId, message: `เริ่มทำงานแล้วครับ PR จะพร้อมใน 2-5 นาที\nRun ID: ${run.runId}` }
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to start workflow' }
        }
      },
    },
    check_pr_status: {
      description: 'Check the status of a previously started dev workflow run',
      inputSchema: z.object({
        run_id: z.string().describe('The workflow run ID returned by apply_changes'),
      }),
      execute: async (input: unknown) => {
        const { run_id } = input as { run_id: string }
        try {
          const run = getRun(run_id)
          const result = await Promise.race([
            run.returnValue,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
          ]) as { status: string; pr_url?: string; error?: string } | undefined

          if (!result) return { status: 'running', message: 'ยังทำงานอยู่ครับ' }
          if (result.status === 'done') return { status: 'done', pr_url: result.pr_url, message: `PR พร้อมแล้วครับ: ${result.pr_url}` }
          return { status: 'failed', error: result.error }
        } catch {
          return { status: 'running', message: 'ยังทำงานอยู่ รอสักครู่แล้วเช็คใหม่ครับ' }
        }
      },
    },
  }

  // ─── LLM ──────────────────────────────────────────────────────────────────

  const modelMessages = await convertToModelMessages(messages)
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey })
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(5),
    })
    return result.toTextStreamResponse()
  }

  // Fallback: Qwen
  const qwen = createOpenAICompatible({
    name: 'qwen',
    baseURL: QWEN_RUNPOD_URL,
    headers: { Authorization: `Bearer ${QWEN_RUNPOD_TOKEN}` },
  })
  const result = streamText({
    model: qwen(QWEN_MODEL_NAME),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
  })
  return result.toTextStreamResponse()
}

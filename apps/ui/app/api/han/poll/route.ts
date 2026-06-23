import { NextRequest, NextResponse, after } from 'next/server'
import { Client as NotionClient, isFullPage } from '@notionhq/client'
import { CRON_SECRET, APP_URL, getServerConfig } from '@/lib/server-config'
import type {
  PageObjectResponse,
  UpdatePageParameters,
} from '@notionhq/client/build/src/api-endpoints.js'
import { google } from 'googleapis'
import Redis from 'ioredis'
import type { TaskType, TaskStatus } from '@/lib/types'
import { redisOptionsFromUrl } from '@/lib/redis-options'
import { callBrain } from '@/lib/call-brain'
import { createGoogleDoc, createGoogleSheet, createGoogleSlides } from '@/lib/google-drive'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const NOTION_RATE_LIMIT_RETRIES = 3
const NOTION_RATE_LIMIT_FALLBACK_MS = 1_000
const MAX_CONTENT_CHARS = 10_000

interface CloudProject {
  notion_db_id: string
  google_drive_folder_id?: string
  github_repo?: string
  github_token?: string
}

interface CloudTask {
  id: string
  notion_page_id: string
  title: string
  type: TaskType
  retry_count: number
  context?: string
}


function getAcceptTypes(): TaskType[] {
  return ['dev', 'doc', 'sheet', 'slide']
}

type PageProps = PageObjectResponse['properties']
type PropValue = PageProps[string]

function getTitle(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key]
  if (prop?.type === 'title' && prop.title.length > 0) return prop.title[0]?.plain_text ?? null
  return null
}

function getSelect(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key]
  if (prop?.type === 'select') return prop.select?.name ?? null
  return null
}

function getNumber(props: PageProps, key: string): number | null {
  const prop: PropValue | undefined = props[key]
  if (prop?.type === 'number') return prop.number
  return null
}

function getRichText(props: PageProps, key: string): string | null {
  const prop: PropValue | undefined = props[key]
  if (prop?.type === 'rich_text' && prop.rich_text.length > 0)
    return prop.rich_text[0]?.plain_text ?? null
  return null
}

async function getApprovedTasks(
  notion: NotionClient,
  dbId: string,
  acceptTypes: TaskType[],
): Promise<CloudTask[]> {
  const res = await withNotionRateLimitRetry('query approved tasks', () =>
    notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: 'status', select: { equals: 'Approve' } },
          { property: 'type', select: { is_not_empty: true } },
        ],
      },
      sorts: [{ property: 'priority', direction: 'ascending' }],
    }),
  )

  const tasks: CloudTask[] = []
  for (const page of res.results) {
    if (!isFullPage(page)) continue
    const props = page.properties
    const type = getSelect(props, 'type') as TaskType | null
    if (type === null || !acceptTypes.includes(type)) continue
    const retryCount = getNumber(props, 'retry_count') ?? 0
    if (retryCount >= 3) continue
    const task: CloudTask = {
      id: page.id.replace(/-/g, ''),
      notion_page_id: page.id,
      title: getTitle(props, 'title') ?? 'Untitled',
      type,
      retry_count: retryCount,
    }
    const context = getRichText(props, 'context')
    if (context !== null) task.context = context
    tasks.push(task)
  }
  return tasks
}

async function updateTaskStatus(
  notion: NotionClient,
  pageId: string,
  status: TaskStatus,
  extra: {
    claimed_by?: string
    claimed_at?: string
    output_url?: string
    error_log?: string
    brain_used?: string
    retry_count?: number
  },
): Promise<void> {
  const properties: UpdatePageParameters['properties'] = {
    status: { select: { name: status } },
  }
  if (extra.claimed_by !== undefined) properties['claimed_by'] = { select: { name: extra.claimed_by } }
  if (extra.claimed_at !== undefined) properties['claimed_at'] = { date: { start: extra.claimed_at } }
  if (extra.output_url !== undefined) properties['output_url'] = { url: extra.output_url }
  if (extra.error_log !== undefined)
    properties['error_log'] = {
      rich_text: [{ type: 'text', text: { content: extra.error_log } }],
    }
  if (extra.brain_used !== undefined) properties['brain_used'] = { select: { name: extra.brain_used } }
  if (extra.retry_count !== undefined) properties['retry_count'] = { number: extra.retry_count }
  await withNotionRateLimitRetry('update task status', () =>
    notion.pages.update({ page_id: pageId, properties }),
  )
}

const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{25,44}$/

function createDriveAuth() {
  const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
  const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON not set')
  const clientCfg = (JSON.parse(clientJson) as { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } }).installed ?? (JSON.parse(clientJson) as { web?: { client_id?: string; client_secret?: string } }).web
  if (!clientCfg?.client_id || !clientCfg.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')
  const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret)
  const tokenJson = process.env.GOOGLE_OAUTH_TOKEN_JSON
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
  if (tokenJson) {
    oauth2.setCredentials(JSON.parse(tokenJson) as object)
  } else if (tokenPath && existsSync(tokenPath)) {
    oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')) as object)
  } else {
    throw new Error('Set GOOGLE_OAUTH_TOKEN_JSON (Vercel) or GOOGLE_OAUTH_TOKEN_PATH (local)')
  }
  return oauth2
}

async function readDriveContent(
  folderId: string,
  taskType: 'doc' | 'sheet' | 'slide',
): Promise<string> {
  if (!DRIVE_ID_RE.test(folderId)) throw new Error(`Invalid folderId: ${folderId}`)
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 100,
  })
  const mimeMap = {
    doc: 'application/vnd.google-apps.document',
    sheet: 'application/vnd.google-apps.spreadsheet',
    slide: 'application/vnd.google-apps.presentation',
  }
  const matched = (filesRes.data.files ?? []).filter((f) => f.mimeType === mimeMap[taskType])
  const contents = await Promise.all(
    matched.map(async (file) => {
      let content = ''
      if (taskType === 'doc') {
        const docs = google.docs({ version: 'v1', auth })
        const doc = await docs.documents.get({ documentId: file.id! })
        const parts: string[] = []
        for (const el of doc.data.body?.content ?? []) {
          for (const pe of el.paragraph?.elements ?? []) {
            const text = (pe as { textRun?: { content?: string } }).textRun?.content
            if (text) parts.push(text)
          }
        }
        content = parts.join('')
      } else if (taskType === 'sheet') {
        const sheets = google.sheets({ version: 'v4', auth })
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: file.id!,
          range: 'A1:ZZ1000',
        })
        content = (res.data.values ?? []).map((row) => row.join('\t')).join('\n')
      } else {
        const slides = google.slides({ version: 'v1', auth })
        const res = await slides.presentations.get({ presentationId: file.id! })
        const parts: string[] = []
        for (const slide of res.data.slides ?? []) {
          for (const el of slide.pageElements ?? []) {
            const textEls = (
              el.shape?.text as
                | { textElements?: Array<{ textRun?: { content?: string } }> }
                | undefined
            )?.textElements ?? []
            for (const te of textEls) {
              if (te.textRun?.content) parts.push(te.textRun.content)
            }
          }
        }
        content = parts.join('\n')
      }
      const truncated =
        content.length > MAX_CONTENT_CHARS
          ? content.slice(0, MAX_CONTENT_CHARS) + '...[truncated]'
          : content
      return `=== ${file.name} ===\n${truncated}`
    }),
  )
  return contents.join('\n\n')
}

async function withNotionRateLimitRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt <= NOTION_RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (err) {
      if (!isNotionRateLimitError(err) || attempt === NOTION_RATE_LIMIT_RETRIES) throw err
      const waitMs =
        getRetryAfterMs(err) ??
        Math.min(NOTION_RATE_LIMIT_FALLBACK_MS * 2 ** attempt, 10_000)
      console.warn(
        `Notion rate limited during ${operationName}; retrying in ${Math.round(waitMs / 1000)}s`,
      )
      await sleep(waitMs)
    }
  }
  return operation()
}

function isNotionRateLimitError(err: unknown): boolean {
  const r = asRecord(err)
  return r['status'] === 429 || r['code'] === 'rate_limited'
}

function getRetryAfterMs(err: unknown): number | null {
  const direct = getHeaderValue(asRecord(err)['headers'], 'retry-after')
  const nested = getHeaderValue(asRecord(asRecord(err)['response'])['headers'], 'retry-after')
  const value = direct ?? nested
  if (value === null) return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.max(1_000, seconds * 1_000)
}

function getHeaderValue(headers: unknown, name: string): string | null {
  if (headers === null || headers === undefined) return null
  if (
    typeof headers === 'object' &&
    'get' in headers &&
    typeof (headers as { get: unknown }).get === 'function'
  ) {
    const value = (headers as { get(n: string): unknown }).get(name)
    return typeof value === 'string' ? value : null
  }
  const record = asRecord(headers)
  const value = record[name] ?? record[name.toLowerCase()]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = CRON_SECRET
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cfg = await getServerConfig()
  const notionToken = cfg.NOTION_TOKEN
  const redisUrl = cfg.REDIS_URL
  const machineId = cfg.HAN_MACHINE_ID
  const projects = cfg.PROJECTS as CloudProject[]
  const acceptTypes = getAcceptTypes()

  if (projects.length === 0) {
    return NextResponse.json({ status: 'no_tasks', reason: 'HAN_PROJECTS_JSON is empty' })
  }

  const notion = new NotionClient({ auth: notionToken })
  const redis = new Redis(redisOptionsFromUrl(redisUrl))

  try {
    for (const project of projects) {
      let tasks: CloudTask[]
      try {
        tasks = await getApprovedTasks(notion, project.notion_db_id, acceptTypes)
      } catch {
        continue
      }

      for (const task of tasks) {
        const lockKey = `task:${task.id}:lock`
        const claimed = await redis.set(lockKey, machineId, 'EX', 300, 'NX')
        if (claimed === null) continue

        await updateTaskStatus(notion, task.notion_page_id, 'In-Progress', {
          claimed_by: machineId,
          claimed_at: new Date().toISOString(),
        })

        // dev task → dispatch to /api/han/dev (fire-and-forget)
        if (task.type === 'dev') {
          if (!project.github_repo) {
            const retryCount = task.retry_count + 1
            const newStatus: TaskStatus = retryCount >= 3 ? 'Failed' : 'Approve'
            await updateTaskStatus(notion, task.notion_page_id, newStatus, {
              error_log: 'github_repo not configured in HAN_PROJECTS_JSON',
              retry_count: retryCount,
            })
            const owner = await redis.get(lockKey)
            if (owner === machineId) await redis.del(lockKey)
            return NextResponse.json(
              { status: 'failed', task_id: task.id, error: 'github_repo not configured' },
              { status: 500 },
            )
          }

          after(async () => {
            await fetch(`${APP_URL}/api/han/dev`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secret}`,
              },
              body: JSON.stringify({
                task: {
                  id: task.id,
                  notion_page_id: task.notion_page_id,
                  title: task.title,
                  type: task.type,
                  retry_count: task.retry_count,
                  ...(task.context !== undefined ? { context: task.context } : {}),
                },
                project: {
                  notion_db_id: project.notion_db_id,
                  github_repo: project.github_repo,
                  ...(project.github_token ? { github_token: project.github_token } : {}),
                },
                lockKey,
              }),
            }).catch((e: unknown) => {
              console.error(
                '[han/poll] dev dispatch error:',
                e instanceof Error ? e.message : String(e),
              )
            })
          })

          return NextResponse.json({ status: 'dispatched_to_dev', task_id: task.id })
        }

        // doc/sheet/slide → execute directly on Vercel
        try {
          const taskType = task.type as 'doc' | 'sheet' | 'slide'
          const systemPrompt = `You are Han AI — an autonomous ${taskType} agent.`
          let driveContent = ''
          if (project.google_drive_folder_id) {
            driveContent = await readDriveContent(
              project.google_drive_folder_id,
              taskType,
            )
          }
          const userPrompt = [
            `Task: ${task.title}`,
            task.context ? `\nContext:\n${task.context}` : '',
            driveContent ? `\n\nGoogle Drive Content:\n${driveContent}` : '',
            taskType === 'doc'   ? '\nReturn the full document content as plain text.' :
            taskType === 'sheet' ? '\nReturn the spreadsheet as CSV (comma-separated values).' :
                                   '\nReturn each slide as a markdown block separated by "---". Use ## for title and - for bullets.',
          ].join('')

          const brainName = cfg.HAN_BRAIN
          const content = await callBrain(systemPrompt, userPrompt)

          let outputUrl: string | undefined
          if (project.google_drive_folder_id) {
            if (taskType === 'doc') {
              outputUrl = await createGoogleDoc(project.google_drive_folder_id, task.title, content)
            } else if (taskType === 'sheet') {
              outputUrl = await createGoogleSheet(project.google_drive_folder_id, task.title, content)
            } else {
              outputUrl = await createGoogleSlides(project.google_drive_folder_id, task.title, content)
            }
          }

          await updateTaskStatus(notion, task.notion_page_id, 'Done', {
            brain_used: brainName,
            ...(outputUrl !== undefined && { output_url: outputUrl }),
          })
          return NextResponse.json({ status: 'completed', task_id: task.id, brain_used: brainName, output_url: outputUrl })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const retryCount = task.retry_count + 1
          const newStatus: TaskStatus = retryCount >= 3 ? 'Failed' : 'Approve'
          await updateTaskStatus(notion, task.notion_page_id, newStatus, {
            error_log: msg,
            retry_count: retryCount,
          })
          return NextResponse.json(
            { status: 'failed', task_id: task.id, notion_status: newStatus, error: msg },
            { status: 500 },
          )
        } finally {
          const owner = await redis.get(lockKey)
          if (owner === machineId) await redis.del(lockKey)
        }
      }
    }

    return NextResponse.json({ status: 'no_tasks' })
  } finally {
    await redis.quit()
  }
}

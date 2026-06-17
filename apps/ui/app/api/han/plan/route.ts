import { readFileSync, existsSync } from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { Client as NotionClient } from '@notionhq/client'
import { google } from 'googleapis'
import { callBrain } from '@/lib/call-brain'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const PLAN_SYSTEM_PROMPT = `You are Han AI planning agent. Extract tasks from Google Drive content.
Return ONLY a compact JSON array (no whitespace, no markdown, no explanation).
Each task: {"title":"...","type":"dev|doc|sheet|slide","status":"New","priority":1,"context":"..."}
Rules: use content only, no duplicates, keep context under 100 chars, max 8 tasks.
- Keep titles concise and imperative.`

const MAX_CONTENT_CHARS = 30_000
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{25,44}$/

interface CloudProject {
  notion_db_id: string
  google_drive_folder_id?: string
  github_repo?: string
}

interface PlannedTask {
  title: string
  type: string
  status: string
  priority: number
  context: string
}

function getProjects(): CloudProject[] {
  const raw = process.env.HAN_PROJECTS_JSON ?? '[]'
  try {
    return JSON.parse(raw) as CloudProject[]
  } catch {
    throw new Error('HAN_PROJECTS_JSON is not valid JSON')
  }
}

function createDriveAuth() {
  const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON not set')
  if (!tokenPath) throw new Error('GOOGLE_OAUTH_TOKEN_PATH not set')
  if (!existsSync(tokenPath)) throw new Error(`OAuth token file not found: ${tokenPath}`)

  const clientConfig = (JSON.parse(clientJson) as {
    installed?: { client_id?: string; client_secret?: string }
    web?: { client_id?: string; client_secret?: string }
  }).installed ?? (JSON.parse(clientJson) as {
    installed?: { client_id?: string; client_secret?: string }
    web?: { client_id?: string; client_secret?: string }
  }).web
  if (!clientConfig?.client_id || !clientConfig.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')

  const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret)
  oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')) as object)
  return oauth2
}

async function readDriveFolder(folderId: string): Promise<string> {
  if (!DRIVE_ID_RE.test(folderId)) throw new Error(`Invalid folderId: ${folderId}`)
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 50,
  })

  const parts: string[] = []

  for (const file of filesRes.data.files ?? []) {
    try {
      let content = ''

      if (file.mimeType === 'application/vnd.google-apps.document') {
        const docs = google.docs({ version: 'v1', auth })
        const doc = await docs.documents.get({ documentId: file.id! })
        const textParts: string[] = []
        for (const el of doc.data.body?.content ?? []) {
          for (const pe of el.paragraph?.elements ?? []) {
            const text = (pe as { textRun?: { content?: string } }).textRun?.content
            if (text) textParts.push(text)
          }
        }
        content = textParts.join('')
      } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        const sheets = google.sheets({ version: 'v4', auth })
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: file.id!,
          range: 'A1:ZZ1000',
        })
        content = (res.data.values ?? []).map((row) => row.join('\t')).join('\n')
      } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
        const slides = google.slides({ version: 'v1', auth })
        const res = await slides.presentations.get({ presentationId: file.id! })
        const textParts: string[] = []
        for (const slide of res.data.slides ?? []) {
          for (const el of slide.pageElements ?? []) {
            const textEls = (
              el.shape?.text as { textElements?: Array<{ textRun?: { content?: string } }> } | undefined
            )?.textElements ?? []
            for (const te of textEls) {
              if (te.textRun?.content) textParts.push(te.textRun.content)
            }
          }
        }
        content = textParts.join('\n')
      }

      if (content.trim().length > 0) {
        parts.push(`=== ${file.name} ===\n${content}`)
      }
    } catch {
      // skip unreadable files
    }
  }

  const full = parts.join('\n\n')
  return full.length > MAX_CONTENT_CHARS ? `${full.slice(0, MAX_CONTENT_CHARS)}\n...[truncated]` : full
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  const start = trimmed.startsWith('[') ? 0 : trimmed.indexOf('[')
  if (start === -1) throw new Error('Brain output did not contain a JSON array')

  const slice = trimmed.slice(start)
  const end = slice.lastIndexOf(']')

  // Full valid array
  if (end !== -1) {
    try { return JSON.parse(slice.slice(0, end + 1)) } catch { /* fall through to recovery */ }
  }

  // Output was truncated — recover all complete objects before the cut-off
  const lastClose = Math.max(slice.lastIndexOf('},'), slice.lastIndexOf('}\n,'), slice.lastIndexOf('} ,'))
  const recovery = lastClose !== -1
    ? slice.slice(0, lastClose + 1) + ']'
    : slice.lastIndexOf('}') !== -1
      ? slice.slice(0, slice.lastIndexOf('}') + 1) + ']'
      : null

  if (recovery !== null) {
    try {
      const parsed = JSON.parse(recovery)
      console.warn(`[han/plan] truncated brain output recovered: ${(parsed as unknown[]).length} task(s)`)
      return parsed
    } catch { /* fall through */ }
  }

  throw new Error('Brain output did not contain a parseable JSON array')
}

function validatePlannedTasks(value: unknown): PlannedTask[] {
  if (!Array.isArray(value)) throw new Error('Brain output must be a JSON array')
  const VALID_TYPES = new Set(['dev', 'doc', 'sheet', 'slide'])
  return value.map((item, i) => {
    const t = item as Partial<PlannedTask>
    if (typeof t.title !== 'string' || t.title.trim().length === 0) throw new Error(`Task ${i + 1}: invalid title`)
    if (typeof t.type !== 'string' || !VALID_TYPES.has(t.type)) throw new Error(`Task ${i + 1}: invalid type`)
    if (t.status !== 'New') throw new Error(`Task ${i + 1}: status must be "New"`)
    if (typeof t.priority !== 'number') throw new Error(`Task ${i + 1}: invalid priority`)
    if (typeof t.context !== 'string' || t.context.trim().length === 0) throw new Error(`Task ${i + 1}: invalid context`)
    return {
      title: t.title.trim(),
      type: t.type,
      status: 'New',
      priority: t.priority,
      context: t.context.trim(),
    }
  })
}

async function createNotionTask(notion: NotionClient, dbId: string, task: PlannedTask): Promise<string> {
  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      title: { title: [{ text: { content: task.title } }] },
      type: { select: { name: task.type } },
      status: { select: { name: 'New' } },
      priority: { number: task.priority },
      context: { rich_text: [{ text: { content: task.context.slice(0, 2000) } }] },
    },
  })
  return page.id
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const notionToken = process.env.NOTION_TOKEN
  if (!notionToken) return NextResponse.json({ error: 'NOTION_TOKEN required' }, { status: 500 })

  const projects = getProjects().filter((p) => p.google_drive_folder_id !== undefined)
  if (projects.length === 0) {
    return NextResponse.json({ status: 'no_projects_with_drive', created: 0 })
  }

  const notion = new NotionClient({ auth: notionToken })
  const summary: Array<{ project: string; tasks: string[] }> = []

  for (const project of projects) {
    try {
      const driveContent = await readDriveFolder(project.google_drive_folder_id!)
      if (driveContent.trim().length === 0) continue

      const userPrompt = [
        'Google Drive files:',
        driveContent,
        '',
        'Create a task plan from the content above.',
        'Return only JSON array.',
      ].join('\n')

      const brainOutput = await callBrain(PLAN_SYSTEM_PROMPT, userPrompt)
      const tasks = validatePlannedTasks(extractJsonArray(brainOutput))

      const created: string[] = []
      for (const task of tasks) {
        const id = await createNotionTask(notion, project.notion_db_id, task)
        created.push(`[${task.type}] P${task.priority} ${task.title} (${id})`)
      }
      summary.push({ project: project.notion_db_id, tasks: created })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[han/plan] project ${project.notion_db_id} error: ${msg}`)
      summary.push({ project: project.notion_db_id, tasks: [`ERROR: ${msg}`] })
    }
  }

  const totalCreated = summary.reduce(
    (acc, s) => acc + s.tasks.filter((t) => !t.startsWith('ERROR')).length,
    0,
  )
  return NextResponse.json({ status: 'ok', total_created: totalCreated, summary })
}

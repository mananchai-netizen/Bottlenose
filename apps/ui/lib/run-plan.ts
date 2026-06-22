import { readFileSync, existsSync } from 'node:fs'
import { Client as NotionClient } from '@notionhq/client'
import { google } from 'googleapis'
import mammoth from 'mammoth'
import { callBrain } from './call-brain'

const PLAN_SYSTEM_PROMPT = `You are Han AI planning agent. Extract tasks from Google Drive content.
Return ONLY a compact JSON array (no whitespace, no markdown, no explanation).
Each task: {"title":"...","type":"dev|doc|sheet|slide","status":"New","priority":1,"context":"..."}
Rules: use content only, no duplicates, keep context under 100 chars, max 8 tasks.
- Keep titles concise and imperative.`

const MAX_CONTENT_CHARS = 8_000
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{25,44}$/

interface CloudProject {
  notion_db_id: string
  google_drive_folder_id?: string
}

interface PlannedTask {
  title: string
  type: string
  status: string
  priority: number
  context: string
}


export interface PlanResult {
  status: string
  total_created: number
  summary: Array<{ project: string; tasks: string[]; moved: string[] }>
}

function createDriveAuth() {
  const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON not set')
  if (!tokenPath) throw new Error('GOOGLE_OAUTH_TOKEN_PATH not set')
  if (!existsSync(tokenPath)) throw new Error(`OAuth token file not found: ${tokenPath}`)

  const parsed = JSON.parse(clientJson) as {
    installed?: { client_id?: string; client_secret?: string }
    web?: { client_id?: string; client_secret?: string }
  }
  const clientConfig = parsed.installed ?? parsed.web
  if (!clientConfig?.client_id || !clientConfig.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')

  const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret)
  oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')) as object)
  return oauth2
}

interface DriveFile { id: string; name: string }
interface ReadResult { content: string; files: DriveFile[] }

async function readDriveFolder(folderId: string): Promise<ReadResult> {
  if (!DRIVE_ID_RE.test(folderId)) throw new Error(`Invalid folderId: ${folderId}`)
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'requirement' and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 50,
  })

  const parts: string[] = []
  const readFiles: DriveFile[] = []

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
          range: 'A1:Z200',
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
      } else if (
        file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimeType === 'application/msword'
      ) {
        // .docx / .doc — ดาวน์โหลด raw bytes แล้วใช้ mammoth แปลงเป็น text
        const res = await drive.files.get(
          { fileId: file.id!, alt: 'media' },
          { responseType: 'arraybuffer' },
        )
        const buffer = Buffer.from(res.data as ArrayBuffer)
        const result = await mammoth.extractRawText({ buffer })
        content = result.value
      } else if (file.mimeType === 'text/plain') {
        // plain text — ดาวน์โหลดตรงๆ
        const res = await drive.files.get(
          { fileId: file.id!, alt: 'media' },
          { responseType: 'text' },
        )
        content = typeof res.data === 'string' ? res.data : ''
      }

      if (content.trim().length > 0) {
        parts.push(`=== ${file.name} ===\n${content}`)
        readFiles.push({ id: file.id!, name: file.name! })
      }
    } catch {
      // skip unreadable files
    }
  }

  const full = parts.join('\n\n')
  const content = full.length > MAX_CONTENT_CHARS ? `${full.slice(0, MAX_CONTENT_CHARS)}\n...[truncated]` : full
  return { content, files: readFiles }
}

async function moveFilesToBackup(files: DriveFile[], sourceFolderId: string, dateStr: string): Promise<string[]> {
  if (files.length === 0) return []
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  // หา หรือสร้าง backup folder
  const listRes = await drive.files.list({
    q: `'${sourceFolderId}' in parents and name = 'backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  })
  let backupId = listRes.data.files?.[0]?.id
  if (!backupId) {
    const created = await drive.files.create({
      requestBody: { name: 'backup', mimeType: 'application/vnd.google-apps.folder', parents: [sourceFolderId] },
      fields: 'id',
    })
    backupId = created.data.id!
  }

  const moved: string[] = []
  for (const file of files) {
    try {
      // เปลี่ยนชื่อ: requirement.docx → requirement_2026-06-22.docx
      const dotIdx = file.name.lastIndexOf('.')
      const newName = dotIdx !== -1
        ? `${file.name.slice(0, dotIdx)}_${dateStr}${file.name.slice(dotIdx)}`
        : `${file.name}_${dateStr}`

      await drive.files.update({
        fileId: file.id,
        addParents: backupId,
        removeParents: sourceFolderId,
        requestBody: { name: newName },
        fields: 'id, name',
      })
      moved.push(newName)
      console.log(`[run-plan] backed up: ${file.name} → backup/${newName}`)
    } catch {
      // skip files that cannot be moved
    }
  }
  return moved
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function extractJsonArray(text: string): unknown {
  const stripped = stripThinkBlocks(text)
  const trimmed = stripped.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  const start = trimmed.startsWith('[') ? 0 : trimmed.indexOf('[')
  if (start === -1) {
    console.error('[run-plan] brain raw output (first 500):', text.slice(0, 500))
    throw new Error(`Brain output did not contain a JSON array. Got: "${trimmed.slice(0, 120)}"`)
  }

  const slice = trimmed.slice(start)
  const end = slice.lastIndexOf(']')

  if (end !== -1) {
    try { return JSON.parse(slice.slice(0, end + 1)) } catch { /* fall through to recovery */ }
  }

  const lastClose = Math.max(slice.lastIndexOf('},'), slice.lastIndexOf('}\n,'), slice.lastIndexOf('} ,'))
  const recovery = lastClose !== -1
    ? slice.slice(0, lastClose + 1) + ']'
    : slice.lastIndexOf('}') !== -1
      ? slice.slice(0, slice.lastIndexOf('}') + 1) + ']'
      : null

  if (recovery !== null) {
    try {
      const parsed = JSON.parse(recovery)
      console.warn(`[run-plan] truncated brain output recovered: ${(parsed as unknown[]).length} task(s)`)
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

function getProjects(): CloudProject[] {
  const raw = process.env.HAN_PROJECTS_JSON ?? '[]'
  try {
    return JSON.parse(raw) as CloudProject[]
  } catch {
    throw new Error('HAN_PROJECTS_JSON is not valid JSON')
  }
}

export async function runPlan(): Promise<PlanResult> {
  const notionToken = process.env.NOTION_TOKEN
  if (!notionToken) throw new Error('NOTION_TOKEN required')

  const projects = getProjects().filter((p) => p.google_drive_folder_id !== undefined)
  if (projects.length === 0) {
    return { status: 'no_projects_with_drive', total_created: 0, summary: [] }
  }

  const notion = new NotionClient({ auth: notionToken })
  const summary: Array<{ project: string; tasks: string[]; moved: string[] }> = []
  const today = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD

  for (const project of projects) {
    try {
      const { content: driveContent, files: driveFiles } = await readDriveFolder(project.google_drive_folder_id!)
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

      // backup + rename ด้วยวันที่ หลังจากสร้าง task เสร็จแล้ว
      const moved = await moveFilesToBackup(driveFiles, project.google_drive_folder_id!, today)

      summary.push({ project: project.notion_db_id, tasks: created, moved })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[run-plan] project ${project.notion_db_id} error: ${msg}`)
      summary.push({ project: project.notion_db_id, tasks: [`ERROR: ${msg}`], moved: [] })
    }
  }

  const total_created = summary.reduce(
    (acc, s) => acc + s.tasks.filter((t) => !t.startsWith('ERROR')).length,
    0,
  )
  return { status: 'ok', total_created, summary }
}

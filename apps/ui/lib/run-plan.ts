import { readFileSync, existsSync } from 'node:fs'
import { Client as NotionClient } from '@notionhq/client'
import { google, Auth } from 'googleapis'
import type { drive_v3 } from 'googleapis'
import mammoth from 'mammoth'
import { callBrain } from './call-brain'

const PLAN_SYSTEM_PROMPT = `You are Han AI planning agent. Extract tasks from a document.
Output MUST start with [ and end with ] — a raw JSON array, nothing else before or after.
No markdown, no code fences, no explanation, no thinking text outside the array.

Each element: {"title":"imperative verb phrase","type":"dev","status":"New","priority":1,"context":"short reason under 80 chars"}
type must be exactly one of: dev | doc | sheet | slide
priority: 1=highest, 5=lowest

Example output (copy this format exactly):
[{"title":"Build login API","type":"dev","status":"New","priority":1,"context":"JWT auth for mobile app"},{"title":"Write API docs","type":"doc","status":"New","priority":2,"context":"Cover all endpoints with examples"}]`

const MAX_CONTENT_CHARS = 8_000
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{25,44}$/

interface CloudProject {
  notion_db_id: string
  google_drive_folder_id?: string
  google_drive_file_id?: string
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
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON not set')

  const parsed = JSON.parse(clientJson) as {
    installed?: { client_id?: string; client_secret?: string }
    web?: { client_id?: string; client_secret?: string }
  }
  const clientConfig = parsed.installed ?? parsed.web
  if (!clientConfig?.client_id || !clientConfig.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')

  const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret)

  // GOOGLE_OAUTH_TOKEN_JSON = token JSON string directly (Vercel / no filesystem)
  // GOOGLE_OAUTH_TOKEN_PATH = path to token file (local dev)
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

interface DriveFile { id: string; name: string }
interface DriveFileWithContent extends DriveFile { content: string }

async function extractFileContent(
  fileId: string,
  mimeType: string,
  name: string,
  auth: Auth.OAuth2Client,
  drive: drive_v3.Drive,
): Promise<string> {
  if (mimeType === 'application/vnd.google-apps.document') {
    const docs = google.docs({ version: 'v1', auth })
    const doc = await docs.documents.get({ documentId: fileId })
    const parts: string[] = []
    for (const el of doc.data.body?.content ?? []) {
      for (const pe of el.paragraph?.elements ?? []) {
        const text = (pe as { textRun?: { content?: string } }).textRun?.content
        if (text) parts.push(text)
      }
    }
    return parts.join('')
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: fileId, range: 'A1:Z200' })
    return (res.data.values ?? []).map((row) => row.join('\t')).join('\n')
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    const slides = google.slides({ version: 'v1', auth })
    const res = await slides.presentations.get({ presentationId: fileId })
    const parts: string[] = []
    for (const slide of res.data.slides ?? []) {
      for (const el of slide.pageElements ?? []) {
        const textEls = (
          el.shape?.text as { textElements?: Array<{ textRun?: { content?: string } }> } | undefined
        )?.textElements ?? []
        for (const te of textEls) {
          if (te.textRun?.content) parts.push(te.textRun.content)
        }
      }
    }
    return parts.join('\n')
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(res.data as ArrayBuffer)
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  if (mimeType === 'text/plain') {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' })
    return typeof res.data === 'string' ? res.data : ''
  }
  console.warn(`[drive] "${name}" unsupported mimeType: ${mimeType}`)
  return ''
}

async function readSingleFile(fileId: string): Promise<DriveFileWithContent[]> {
  if (!DRIVE_ID_RE.test(fileId)) throw new Error(`Invalid fileId: ${fileId}`)
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  console.log(`[drive] fetching file: id=${fileId}`)
  const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType' })
  const file = meta.data
  console.log(`[drive] reading "${file.name}" (${file.mimeType})`)

  try {
    const raw = await extractFileContent(fileId, file.mimeType!, file.name!, auth, drive)
    if (!raw.trim()) {
      console.warn(`[drive] "${file.name}" → empty content`)
      return []
    }
    const truncated = raw.length > MAX_CONTENT_CHARS
    const content = truncated ? `${raw.slice(0, MAX_CONTENT_CHARS)}\n...[truncated]` : raw
    console.log(`[drive] "${file.name}" → ${content.length} chars${truncated ? ' (truncated)' : ''}`)
    return [{ id: file.id!, name: file.name!, content }]
  } catch (err) {
    console.error(`[drive] "${file.name}" read error:`, err instanceof Error ? err.message : String(err))
    return []
  }
}

async function readDriveFolder(folderId: string): Promise<DriveFileWithContent[]> {
  if (!DRIVE_ID_RE.test(folderId)) throw new Error(`Invalid folderId: ${folderId}`)
  const auth = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  console.log(`[drive] scanning folder: ${folderId}`)
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 50,
  })

  const found = filesRes.data.files ?? []
  console.log(`[drive] found ${found.length} file(s):`, found.map((f) => f.name).join(', ') || '(none)')

  const results: DriveFileWithContent[] = []
  for (const file of found) {
    console.log(`[drive] reading "${file.name}" (${file.mimeType}) id=${file.id}`)
    try {
      const raw = await extractFileContent(file.id!, file.mimeType!, file.name!, auth, drive)
      if (!raw.trim()) {
        console.warn(`[drive] "${file.name}" → empty content, skipped`)
        continue
      }
      const truncated = raw.length > MAX_CONTENT_CHARS
      const content = truncated ? `${raw.slice(0, MAX_CONTENT_CHARS)}\n...[truncated]` : raw
      console.log(`[drive] "${file.name}" → ${content.length} chars${truncated ? ' (truncated)' : ''}`)
      results.push({ id: file.id!, name: file.name!, content })
    } catch (err) {
      console.error(`[drive] "${file.name}" read error:`, err instanceof Error ? err.message : String(err))
    }
  }

  console.log(`[drive] files ready: ${results.length}/${found.length}`)
  return results
}

async function moveFilesToBackup(files: DriveFileWithContent[], sourceFolderId: string, dateStr: string): Promise<string[]> {
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
  // 1. ตัด <think>...</think> ออกทั้งหมด
  const stripped = stripThinkBlocks(text)

  // 2. ดึง JSON ออกจาก code block ถ้ามี ```json ... ``` หรือ ``` ... ```
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenceMatch?.[1]?.trim() ?? stripped.trim()

  // 3. หา [ แรก และ ] สุดท้ายในข้อความ (ข้าม text ก่อนหน้า)
  const start = candidate.indexOf('[')
  if (start === -1) {
    console.error('[run-plan] brain raw output (first 800):', text.slice(0, 800))
    throw new Error(`Brain output did not contain a JSON array. Got: "${candidate.slice(0, 200)}"`)
  }

  const slice = candidate.slice(start)
  const end   = slice.lastIndexOf(']')

  // 4. พยายาม parse ตรง ๆ
  if (end !== -1) {
    try { return JSON.parse(slice.slice(0, end + 1)) } catch { /* fall through */ }
  }

  // 5. recovery: ตัดที่ object สุดท้ายที่สมบูรณ์
  const lastClose = Math.max(
    slice.lastIndexOf('},'),
    slice.lastIndexOf('}\n,'),
    slice.lastIndexOf('} ,'),
    slice.lastIndexOf('}\n]'),
  )
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

  console.error('[run-plan] brain raw output (first 800):', text.slice(0, 800))
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

  const projects = getProjects().filter((p) => p.google_drive_file_id ?? p.google_drive_folder_id)
  if (projects.length === 0) {
    return { status: 'no_projects_with_drive', total_created: 0, summary: [] }
  }

  const notion = new NotionClient({ auth: notionToken })
  const summary: Array<{ project: string; tasks: string[]; moved: string[] }> = []
  const now = new Date()
  const today = `${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 8).replace(/:/g, '')}`  // YYYY-MM-DD_HHmmss

  for (const project of projects) {
    console.log(`\n[run-plan] ── project: ${project.notion_db_id} ──`)
    try {
      const fileId = project.google_drive_file_id
      const folderId = project.google_drive_folder_id
      console.log(`[run-plan] step 1/3 — reading Google Drive ${fileId ? `file: ${fileId}` : `folder: ${folderId}`}`)

      const driveFiles = fileId
        ? await readSingleFile(fileId)
        : await readDriveFolder(folderId!)

      if (driveFiles.length === 0) {
        console.log(`[run-plan] no files with content, skipping project`)
        continue
      }

      console.log(`[run-plan] step 2/3 — processing ${driveFiles.length} file(s) through brain (one by one)`)
      const created: string[] = []

      for (const file of driveFiles) {
        console.log(`[run-plan]   brain ← "${file.name}" (${file.content.length} chars)`)
        try {
          const userPrompt = [
            `File: ${file.name}`,
            '',
            file.content,
            '',
            'Extract ALL tasks from this document. Return only JSON array.',
          ].join('\n')

          let brainOutput = await callBrain(PLAN_SYSTEM_PROMPT, userPrompt)
          let tasks: PlannedTask[] | null = null

          // retry 1 ครั้งถ้า parse ไม่ได้ — ส่ง output เดิมกลับให้ brain แก้
          try {
            tasks = validatePlannedTasks(extractJsonArray(brainOutput))
          } catch {
            console.warn(`[run-plan]   parse failed for "${file.name}", retrying with fix prompt…`)
            const fixPrompt = [
              'Your previous response could not be parsed as a JSON array.',
              'Previous response:',
              brainOutput.slice(0, 1000),
              '',
              'Return ONLY the JSON array now, starting with [ and ending with ]. No other text.',
            ].join('\n')
            brainOutput = await callBrain(PLAN_SYSTEM_PROMPT, fixPrompt)
            tasks = validatePlannedTasks(extractJsonArray(brainOutput))
          }

          console.log(`[run-plan]   brain → ${tasks.length} task(s) from "${file.name}"`)

          for (const task of tasks) {
            const id = await createNotionTask(notion, project.notion_db_id, task)
            const entry = `[${task.type}] P${task.priority} ${task.title} (${id})`
            console.log(`[run-plan]     ✓ ${entry}`)
            created.push(entry)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[run-plan]   brain error for "${file.name}": ${msg}`)
        }
      }

      console.log(`[run-plan] step 3/3 — backup ${driveFiles.length} file(s)`)
      const moved = folderId ? await moveFilesToBackup(driveFiles, folderId, today) : []
      console.log(`[run-plan] done — ${created.length} task(s) created, ${moved.length} file(s) backed up`)

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

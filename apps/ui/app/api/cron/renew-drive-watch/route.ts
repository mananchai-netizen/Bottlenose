import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { google } from 'googleapis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ChannelRecord {
  folderId: string
  channelId: string
  resourceId: string
}

function createDriveAuth() {
  const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
  if (!clientJson) throw new Error('GOOGLE_OAUTH_CLIENT_JSON not set')

  const parsed = JSON.parse(clientJson) as {
    installed?: { client_id?: string; client_secret?: string }
    web?: { client_id?: string; client_secret?: string }
  }
  const cfg = parsed.installed ?? parsed.web
  if (!cfg?.client_id || !cfg.client_secret) throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON')

  const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret)

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

function getProjects(): Array<{ google_drive_folder_id?: string }> {
  try { return JSON.parse(process.env.HAN_PROJECTS_JSON ?? '[]') } catch { return [] }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const webhookUrl = `${process.env.APP_URL}/api/drive/webhook`
  const webhookSecret = process.env.DRIVE_WEBHOOK_SECRET
  if (!webhookSecret) return NextResponse.json({ error: 'DRIVE_WEBHOOK_SECRET not set' }, { status: 500 })
  if (!process.env.APP_URL) return NextResponse.json({ error: 'APP_URL not set' }, { status: 500 })

  const folderIds = getProjects()
    .map((p) => p.google_drive_folder_id)
    .filter((id): id is string => !!id)

  if (folderIds.length === 0) {
    return NextResponse.json({ status: 'no_projects', renewed: [] })
  }

  const auth  = createDriveAuth()
  const drive = google.drive({ version: 'v3', auth })

  // หยุด channel เดิมก่อน (ถ้ามี)
  const existingJson = process.env.DRIVE_CHANNEL_RECORDS
  if (existingJson) {
    const records = JSON.parse(existingJson) as ChannelRecord[]
    for (const rec of records) {
      try {
        await drive.channels.stop({ requestBody: { id: rec.channelId, resourceId: rec.resourceId } })
        console.log('[renew-watch] stopped channel', rec.channelId)
      } catch { /* channel อาจหมดอายุแล้ว — ข้ามได้ */ }
    }
  }

  // ลงทะเบียน channel ใหม่
  const renewed: ChannelRecord[] = []
  for (const folderId of folderIds) {
    try {
      const channelId = randomUUID()
      const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000  // 6 วัน

      const res = await drive.files.watch({
        fileId: folderId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          token: webhookSecret,
          expiration: String(expiration),
        },
      })

      renewed.push({
        folderId,
        channelId,
        resourceId: res.data.resourceId ?? '',
      })
      console.log('[renew-watch] registered channel', channelId, 'for folder', folderId)
    } catch (err) {
      console.error('[renew-watch] failed for folder', folderId, err instanceof Error ? err.message : String(err))
    }
  }

  // log ค่า DRIVE_CHANNEL_RECORDS ใหม่ (ต้องอัพเดต env var บน Vercel ด้วยตนเอง หรือใช้ Vercel API)
  const newRecords = JSON.stringify(renewed)
  console.log('[renew-watch] update DRIVE_CHANNEL_RECORDS env var to:', newRecords)

  return NextResponse.json({ status: 'ok', renewed })
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { CRON_SECRET, APP_URL } from '@/lib/server-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

// เก็บ token ล่าสุดไว้ให้ GET /api/notion/webhook ดึงได้
let lastVerificationToken: string | null = null
export function getLastVerificationToken() { return lastVerificationToken }

function isValidSignature(rawBody: string, signature: string | null, token: string): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', token).update(rawBody).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text()

  let payload: unknown
  try {
    payload = rawBody.length > 0 ? (JSON.parse(rawBody) as unknown) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Notion verification handshake — echo token กลับเพื่อยืนยัน endpoint
  const verificationToken = (payload as { verification_token?: unknown }).verification_token
  if (typeof verificationToken === 'string' && verificationToken.length > 0) {
    lastVerificationToken = verificationToken
    process.stdout.write('\n>>> NOTION_VERIFICATION_TOKEN=' + verificationToken + '\n\n')
    return NextResponse.json({ verification_token: verificationToken })
  }

  // ตรวจ HMAC signature (ถ้าตั้ง token ไว้)
  const token = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
  if (token !== undefined && token.trim().length > 0) {
    const allowUnsigned =
      process.env.NODE_ENV !== 'production' &&
      process.env.NOTION_WEBHOOK_ALLOW_UNSIGNED_DEV === '1'

    if (!allowUnsigned && !isValidSignature(rawBody, request.headers.get('x-notion-signature'), token)) {
      console.warn('[notion/webhook] invalid_signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // log raw payload เพื่อดู structure จริงจาก Notion
  console.log('[notion/webhook] raw payload:', JSON.stringify(payload, null, 2))

  // อ่าน page_id และ project_id จาก payload
  const event = payload as {
    entity?: { id?: string }
    data?: { parent?: { id?: string; type?: string; database_id?: string } }
  }
  const pageId = event.entity?.id
  const projectId = event.data?.parent?.database_id ?? event.data?.parent?.id

  // fetch status, type, title จาก Notion API
  if (pageId) {
    const notionToken = process.env.NOTION_TOKEN
    fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    })
      .then((r) => r.json())
      .then((page: unknown) => {
        const props = (page as { properties?: Record<string, unknown> }).properties ?? {}
        const title = (props['title'] as { title?: Array<{ plain_text?: string }> })?.title?.[0]?.plain_text ?? '-'
        const status = (props['status'] as { select?: { name?: string } })?.select?.name ?? '-'
        const type = (props['type'] as { select?: { name?: string } })?.select?.name ?? '-'
        console.log('[notion/webhook] task info:')
        console.log('  project_id :', projectId ?? '-')
        console.log('  page_id    :', pageId)
        console.log('  title      :', title)
        console.log('  type       :', type)
        console.log('  status     :', status)
      })
      .catch(() => {
        console.log('[notion/webhook] task info: page_id =', pageId, '| project_id =', projectId ?? '-')
      })
  }

  // Trigger /api/han/poll แบบ fire-and-forget ผ่าน after()
  after(async () => {
    console.log('[notion/webhook] after() → calling poll', APP_URL)
    try {
      const res = await fetch(`${APP_URL}/api/han/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CRON_SECRET}`,
        },
      })
      const data = await res.json() as unknown
      console.log('[notion/webhook] poll result:', JSON.stringify(data))
    } catch (e: unknown) {
      console.error('[notion/webhook] poll dispatch error:', e instanceof Error ? e.message : String(e))
    }
  })
  console.log('[notion/webhook] poll triggered')

  return NextResponse.json({ status: 'ok', triggered: true })
}

export function GET(): NextResponse {
  if (lastVerificationToken) {
    return NextResponse.json({ verification_token: lastVerificationToken })
  }
  return NextResponse.json({ verification_token: null, message: 'No token received yet' })
}

import { after, NextRequest, NextResponse } from 'next/server'
import { runPlan } from '@/lib/run-plan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function POST(request: NextRequest): Promise<NextResponse> {
  const state    = request.headers.get('x-goog-resource-state')
  const token    = request.headers.get('x-goog-channel-token')
  const secret   = process.env.DRIVE_WEBHOOK_SECRET

  // ตรวจ token ก่อน (ป้องกัน request ปลอม)
  if (secret && token !== secret) {
    console.warn('[drive/webhook] invalid token')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Google ส่ง sync ครั้งแรกเพื่อ verify endpoint — ตอบ 200 เฉยๆ
  if (state === 'sync') {
    console.log('[drive/webhook] sync handshake ok')
    return NextResponse.json({ status: 'ok' })
  }

  // รับเฉพาะ add / update — ไม่สนใจ remove / trash
  if (state !== 'add' && state !== 'update') {
    return NextResponse.json({ status: 'ignored', state })
  }

  console.log('[drive/webhook] change detected, state =', state, '→ scheduling runPlan()')

  after(async () => {
    try {
      const result = await runPlan()
      console.log('[drive/webhook] runPlan done:', result.total_created, 'task(s) created')
    } catch (err) {
      console.error('[drive/webhook] runPlan error:', err instanceof Error ? err.message : String(err))
    }
  })

  return NextResponse.json({ status: 'ok', triggered: true })
}

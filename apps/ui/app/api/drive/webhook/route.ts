import { after, NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { Redis } from 'ioredis'
import { runPlan } from '@/lib/run-plan'
import { REDIS_URL } from '@/lib/server-config'
import { redisOptionsFromUrl } from '@/lib/redis-options'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 330  // 15s debounce + max runPlan time

const DEBOUNCE_MS = 15_000      // รอ 15 วิหลัง webhook สุดท้าย
const DEBOUNCE_TTL_SEC = 20     // Redis key TTL (> DEBOUNCE_MS)

function createRedis(): Redis {
  return new Redis(redisOptionsFromUrl(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
  }))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const state      = request.headers.get('x-goog-resource-state')
  const token      = request.headers.get('x-goog-channel-token')
  const resourceId = request.headers.get('x-goog-resource-id') ?? 'default'
  const secret     = process.env.DRIVE_WEBHOOK_SECRET

  if (secret && token !== secret) {
    console.warn('[drive/webhook] invalid token')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (state === 'sync') {
    console.log('[drive/webhook] sync handshake ok')
    return NextResponse.json({ status: 'ok' })
  }

  if (state !== 'add' && state !== 'update') {
    return NextResponse.json({ status: 'ignored', state })
  }

  // สร้าง triggerId ใหม่ทุก webhook — เขียนทับ key เดิม (last-writer-wins)
  const triggerId = randomBytes(8).toString('hex')
  const debounceKey = `drive:debounce:${resourceId}`

  const redis = createRedis()
  try {
    await redis.connect()
    await redis.set(debounceKey, triggerId, 'EX', DEBOUNCE_TTL_SEC)
    console.log(`[drive/webhook] state=${state} triggerId=${triggerId} (debounce ${DEBOUNCE_MS / 1000}s)`)
  } finally {
    redis.disconnect()
  }

  after(async () => {
    // รอ debounce window ให้ครบ
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS))

    // ตรวจว่าเรายัง "คนล่าสุด" อยู่ไหม
    const r = createRedis()
    try {
      await r.connect()
      const current = await r.get(debounceKey)
      if (current !== triggerId) {
        console.log(`[drive/webhook] debounced — newer trigger exists, skip`)
        return
      }
      await r.del(debounceKey)
      console.log(`[drive/webhook] debounce passed — starting runPlan()`)

      const result = await runPlan()
      console.log(`[drive/webhook] runPlan done: ${result.total_created} task(s) created`)
    } catch (err) {
      console.error('[drive/webhook] error:', err instanceof Error ? err.message : String(err))
    } finally {
      r.disconnect()
    }
  })

  return NextResponse.json({ status: 'ok', triggered: true, triggerId })
}

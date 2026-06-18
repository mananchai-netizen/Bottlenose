import { after, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { Redis } from 'ioredis'
import { validateSessionToken, COOKIE_NAME } from '@/lib/auth'
import { REDIS_URL } from '@/lib/server-config'
import { redisOptionsFromUrl } from '@/lib/redis-options'
import { runPlan } from '@/lib/run-plan'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const JOB_TTL_SEC = 3600

export interface PlanJobState {
  status: 'pending' | 'running' | 'done' | 'error'
  step: string
  message: string
  result?: unknown
  error?: string
  createdAt: string
  updatedAt?: string
}

function createRedis(): Redis {
  return new Redis(redisOptionsFromUrl(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
  }))
}

export function planJobKey(jobId: string): string {
  return `plan:job:${jobId}`
}

async function setJobState(redis: Redis, jobId: string, patch: Partial<PlanJobState>): Promise<void> {
  const existing = await redis.get(planJobKey(jobId))
  const prev: PlanJobState = existing
    ? (JSON.parse(existing) as PlanJobState)
    : { status: 'pending', step: 'starting', message: '', createdAt: new Date().toISOString() }
  const next: PlanJobState = { ...prev, ...patch, updatedAt: new Date().toISOString() }
  await redis.set(planJobKey(jobId), JSON.stringify(next), 'EX', JOB_TTL_SEC)
}

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const session = token ? validateSessionToken(token) : null
  if (!session || session.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!REDIS_URL) return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 })

  const jobId = randomBytes(8).toString('hex')
  const redis = createRedis()

  try {
    await redis.connect()
    await redis.set(
      planJobKey(jobId),
      JSON.stringify({
        status: 'pending',
        step: 'starting',
        message: 'กำลังเริ่มต้น...',
        createdAt: new Date().toISOString(),
      } satisfies PlanJobState),
      'EX', JOB_TTL_SEC,
    )
  } finally {
    redis.disconnect()
  }

  after(async () => {
    const r = createRedis()
    try {
      await r.connect()
      await setJobState(r, jobId, { status: 'running', step: 'planning', message: 'กำลังอ่านไฟล์และแตก task...' })

      const data = await runPlan()

      await setJobState(r, jobId, {
        status: 'done',
        step: 'done',
        message: `สร้าง ${data.total_created} task(s) เรียบร้อย`,
        result: data,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await setJobState(r, jobId, { status: 'error', step: 'error', message: 'เกิดข้อผิดพลาด', error: msg })
      } catch { /* ignore */ }
    } finally {
      r.disconnect()
    }
  })

  return NextResponse.json({ jobId })
}

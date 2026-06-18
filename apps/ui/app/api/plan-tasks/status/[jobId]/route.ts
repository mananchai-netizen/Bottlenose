import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { Redis } from 'ioredis'
import { validateSessionToken, COOKIE_NAME } from '@/lib/auth'
import { REDIS_URL } from '@/lib/server-config'
import { redisOptionsFromUrl } from '@/lib/redis-options'
import { planJobKey, type PlanJobState } from '../../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const session = token ? validateSessionToken(token) : null
  if (!session || session.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { jobId } = await params
  if (!jobId || !/^[a-f0-9]{16}$/.test(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
  }

  if (!REDIS_URL) return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 })

  const redis = new Redis(redisOptionsFromUrl(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  }))

  try {
    await redis.connect()
    const raw = await redis.get(planJobKey(jobId))
    if (!raw) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const state = JSON.parse(raw) as PlanJobState
    return NextResponse.json(state)
  } finally {
    redis.disconnect()
  }
}

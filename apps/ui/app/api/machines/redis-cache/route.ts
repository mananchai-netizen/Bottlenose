import { NextResponse } from 'next/server';
import { COOKIE_NAME, validateSessionToken } from '@/lib/auth';
import { getMachineConfig } from '@/lib/config';
import { clearHanRedisCache, isRedisClearMode } from '@/lib/redis-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSession(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  return token === undefined ? null : validateSessionToken(token);
}

export async function POST(request: Request) {
  const session = getSession(request);
  if (session?.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getMachineConfig();
  if (config === null) {
    return NextResponse.json({ error: 'No config found' }, { status: 404 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const mode = typeof body === 'object' && body !== null && 'mode' in body ? body.mode : 'registry';
  if (!isRedisClearMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode. Use registry, locks, or all.' }, { status: 400 });
  }

  try {
    const result = await clearHanRedisCache(config.redis_url, mode);
    return NextResponse.json({ ok: true, mode, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

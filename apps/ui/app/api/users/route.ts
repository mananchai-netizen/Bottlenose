import { NextResponse } from 'next/server';
import { getUsers, saveUser, type UserRecord } from '@/lib/auth';
import { COOKIE_NAME, validateSessionToken } from '@/lib/auth-edge';
import type { Role } from '@/lib/auth-edge';

function getSession(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  if (token === undefined) return null;
  return validateSessionToken(token);
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if ((await session)?.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const users = await getUsers();
  return NextResponse.json(users.map((u) => ({ username: u.username, role: u.role })));
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if ((await session)?.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json()) as Partial<UserRecord>;
  if (!body.username || !body.password || !body.role) {
    return NextResponse.json({ error: 'username, password, role required' }, { status: 400 });
  }
  if (!['root', 'admin'].includes(body.role)) {
    return NextResponse.json({ error: 'role must be root or admin' }, { status: 400 });
  }
  await saveUser({ username: body.username, password: body.password, role: body.role as Role });
  return NextResponse.json({ ok: true });
}

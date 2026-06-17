import { NextResponse } from 'next/server';
import { getUsers, saveUser, deleteUser, type UserRecord } from '@/lib/auth';
import { COOKIE_NAME, validateSessionToken } from '@/lib/auth-edge';
import type { Role } from '@/lib/auth-edge';

type Params = Promise<{ username: string }>;

async function getSession(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match?.[1];
  if (token === undefined) return null;
  return validateSessionToken(token);
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const session = await getSession(request);
  if (session?.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { username } = await params;
  const body = (await request.json()) as Partial<UserRecord>;
  const users = await getUsers();
  const existing = users.find((u) => u.username === username);
  if (existing === undefined) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (body.role !== undefined && !['root', 'admin'].includes(body.role)) {
    return NextResponse.json({ error: 'role must be root or admin' }, { status: 400 });
  }
  await saveUser({
    username,
    password: body.password ?? existing.password,
    role: (body.role as Role) ?? existing.role,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  const session = await getSession(request);
  if (session?.role !== 'root') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { username } = await params;
  const session2 = await getSession(request);
  if (session2?.username === username) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }
  await deleteUser(username);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, createSessionToken, COOKIE_NAME } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { username?: string; password?: string };
  const { username = '', password = '' } = body;

  const user = await validateCredentials(username.trim(), password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const token = createSessionToken(user);
  const redirect = user.role === 'admin' ? '/projects' : '/';

  const res = NextResponse.json({ ok: true, role: user.role, redirect });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return res;
}

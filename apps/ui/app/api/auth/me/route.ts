import { NextRequest, NextResponse } from 'next/server';
import { validateSessionToken, COOKIE_NAME } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value ?? '';
  const session = validateSessionToken(token);
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { username: session.username, role: session.role } });
}

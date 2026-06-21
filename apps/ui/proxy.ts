import { NextRequest, NextResponse } from 'next/server';
import { validateSessionToken, COOKIE_NAME, ROLE_ALLOWED_PATHS } from '@/lib/auth-edge';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/notion/webhook', '/api/drive/webhook', '/api/han/'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value ?? '';
  const session = await validateSessionToken(token);

  if (!session) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Check role-based path access (skip API routes)
  if (!pathname.startsWith('/api/')) {
    const allowed = ROLE_ALLOWED_PATHS[session.role] ?? [];
    const hasAccess = allowed.some((p) => pathname === p || pathname.startsWith(p + '/'));
    if (!hasAccess) {
      const fallback = req.nextUrl.clone();
      fallback.pathname = allowed[0] ?? '/login';
      return NextResponse.redirect(fallback);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|\\.well-known/workflow/).*)'],
};

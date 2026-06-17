'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from './theme-toggle';
import { ROLE_MENUS, type Role } from '@/lib/auth-constants';

function MIntelligenceLogo() {
  return (
    <Link href="/" className="flex items-center mr-6 shrink-0">
      <Image
        src="/logo.png"
        alt="M-Intelligence"
        width={120}
        height={36}
        priority
        className="h-9 w-auto dark:bg-white dark:rounded-md dark:px-2 dark:py-1"
      />
    </Link>
  );
}

const ROLE_BADGE: Record<Role, string> = {
  root:  'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  admin: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
};

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: Role } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: { username: string; role: Role } | null }) => setUser(d.user))
      .catch(() => setUser(null));
  }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  if (pathname === '/login') return null;

  const links = user ? (ROLE_MENUS[user.role] ?? []) : [];

  return (
    <nav className="flex items-center gap-1 border-b border-gray-200 dark:border-zinc-800 px-6 py-3 bg-white dark:bg-zinc-950">
      <MIntelligenceLogo />
      <div className="flex items-center gap-0.5 flex-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              pathname === l.href
                ? 'bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-white font-medium'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800/60'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {user !== null && (
          <>
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              Login by <span className="text-gray-700 dark:text-zinc-300 font-medium">{user.username}</span>
            </span>
            <button
              onClick={() => { void handleLogout(); }}
              className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </>
        )}
        <ThemeToggle />
      </div>
    </nav>
  );
}

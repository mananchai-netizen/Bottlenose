// Shared constants safe to import on both client and server

export const COOKIE_NAME = 'han_session'

export type Role = 'root' | 'admin'

export interface SessionPayload {
  username: string
  role: Role
  exp: number
}

export const ROLE_MENUS: Record<Role, { href: string; label: string }[]> = {
  root:  [
    { href: '/', label: 'Status' },
    { href: '/config', label: 'Config' },
    { href: '/projects', label: 'Projects' },
    { href: '/plan', label: 'Plan Tasks' },
    { href: '/users', label: 'Users' },
    { href: '/qwen', label: 'Qwen' },
  ],
  admin: [{ href: '/projects', label: 'Projects' }],
}

export const ROLE_ALLOWED_PATHS: Record<Role, string[]> = {
  root:  ['/', '/config', '/projects', '/plan', '/users', '/qwen'],
  admin: ['/projects'],
}

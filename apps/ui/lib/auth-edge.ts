// Edge-runtime-compatible auth — no Node.js built-ins (no fs/os/path)
// Server-only: validates session tokens. Client components must import from auth-constants.ts

import type { SessionPayload } from './auth-constants'

export { COOKIE_NAME, ROLE_MENUS, ROLE_ALLOWED_PATHS } from './auth-constants'
export type { Role, SessionPayload } from './auth-constants'

function getSecret(): string {
  const s = process.env.AUTH_SECRET ?? ''
  if (!s) throw new Error('AUTH_SECRET is not set')
  return s
}

function base64urlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

export async function validateSessionToken(token: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  try {
    const key = await getKey()
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlToBytes(sig),
      new TextEncoder().encode(payload),
    )
    if (!valid) return null
    const data = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as SessionPayload
    if (Date.now() > data.exp) return null
    return data
  } catch {
    return null
  }
}

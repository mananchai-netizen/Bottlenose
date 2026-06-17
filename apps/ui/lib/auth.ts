import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { COOKIE_NAME, Role } from './auth-edge'
import { getHanDataDir } from './runtime-paths'

const SECRET = process.env.AUTH_SECRET ?? 'han-ai-internal-secret-2024'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

export type { Role }

export interface UserRecord {
  username: string
  password: string
  role: Role
}

export interface SessionPayload {
  username: string
  role: Role
  exp: number
}

const DEFAULT_USERS: UserRecord[] = [
  { username: 'root',  password: 'root1234',  role: 'root'  },
  { username: 'admin', password: 'admin123',  role: 'admin' },
]

function usersFilePath(): string {
  return path.join(getHanDataDir(), 'users.json')
}

export async function getUsers(): Promise<UserRecord[]> {
  try {
    const raw = fs.readFileSync(usersFilePath(), 'utf8')
    return JSON.parse(raw) as UserRecord[]
  } catch {
    return DEFAULT_USERS
  }
}

export async function validateCredentials(
  username: string,
  password: string,
): Promise<UserRecord | null> {
  const users = await getUsers()
  return users.find((u) => u.username === username && u.password === password) ?? null
}

export async function saveUser(user: UserRecord): Promise<void> {
  const users = await getUsers()
  const idx = users.findIndex((u) => u.username === user.username)
  if (idx >= 0) users[idx] = user
  else users.push(user)
  const dir = getHanDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(usersFilePath(), JSON.stringify(users, null, 2), 'utf8')
}

export async function deleteUser(username: string): Promise<void> {
  const users = await getUsers()
  const filtered = users.filter((u) => u.username !== username)
  const dir = getHanDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(usersFilePath(), JSON.stringify(filtered, null, 2), 'utf8')
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export function createSessionToken(user: UserRecord): string {
  const payload = Buffer.from(
    JSON.stringify({ username: user.username, role: user.role, exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url')
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function validateSessionToken(token: string): SessionPayload | null {
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (sign(payload) !== sig) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionPayload
    if (Date.now() > data.exp) return null
    return data
  } catch {
    return null
  }
}

export { COOKIE_NAME }

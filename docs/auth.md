# Auth System

> Login system สำหรับ Bottlenose UI (`apps/ui`)

---

## Overview

ใช้ config file แทน database — users เก็บใน `~/.han/users.json`
Session เป็น HMAC-SHA256 signed cookie (ไม่ต้องพึ่ง library ภายนอก)

---

## Users Config

**Path:** `~/.han/users.json`

```json
[
  { "username": "root",  "password": "root1234", "role": "root"  },
  { "username": "admin", "password": "admin123",  "role": "admin" }
]
```

### เพิ่ม / แก้ไข User

แก้ไฟล์ `~/.han/users.json` โดยตรง — ไม่ต้อง restart server

**Windows — เขียนแบบไม่มี BOM (สำคัญมาก):**
```powershell
$users = '[{"username":"root","password":"root1234","role":"root"},{"username":"admin","password":"admin123","role":"admin"}]'
[System.IO.File]::WriteAllText("$env:USERPROFILE\.han\users.json", $users, [System.Text.UTF8Encoding]::new($false))
```

> PowerShell 5.1 `Set-Content -Encoding utf8` เพิ่ม BOM ทำให้ `JSON.parse` throw — ใช้ `[System.IO.File]::WriteAllText` เสมอ

---

## Roles

กำหนดใน `apps/ui/lib/auth-edge.ts`

| Role | Menus ที่เห็น | Paths ที่เข้าได้ | Redirect หลัง login |
|---|---|---|---|
| `root` | Status, Config, Projects | `/`, `/config`, `/projects` | `/` |
| `admin` | Projects | `/projects` | `/projects` |

### เพิ่ม Role ใหม่

1. เพิ่ม type ใน `auth-edge.ts`:
```typescript
export type Role = 'root' | 'admin' | 'newrole';
```

2. เพิ่ม menus:
```typescript
export const ROLE_MENUS: Record<Role, ...> = {
  newrole: [{ href: '/projects', label: 'Projects' }],
  ...
};
```

3. เพิ่ม allowed paths:
```typescript
export const ROLE_ALLOWED_PATHS: Record<Role, string[]> = {
  newrole: ['/projects'],
  ...
};
```

4. เพิ่ม badge สี (optional) ใน `components/nav.tsx`:
```typescript
const ROLE_BADGE: Record<Role, string> = {
  newrole: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  ...
};
```

---

## Session Token

**Format:** `base64url(payload).HMAC-SHA256(payload, secret)`

**Payload:**
```json
{ "username": "root", "role": "root", "exp": 1748000000000 }
```

**Cookie:** `han_session` — httpOnly, sameSite=lax, TTL 8 ชั่วโมง

**Secret:** `process.env.AUTH_SECRET` (fallback hardcoded สำหรับ dev)
→ กำหนดใน production: `AUTH_SECRET=your-secret` ใน environment

---

## Auth Files — สำคัญ อย่าผสมกัน

| File | Runtime | ใช้โดย | ใช้ได้ |
|---|---|---|---|
| `lib/auth-edge.ts` | Edge | `proxy.ts` เท่านั้น | Web Crypto, `atob` — ห้ามใช้ `fs/os/path` |
| `lib/auth.ts` | Node.js | API routes เท่านั้น | `fs`, `os`, `path`, Node `crypto` |

### auth-edge.ts exports
- `COOKIE_NAME` — ชื่อ cookie
- `Role` — type สำหรับ roles
- `ROLE_MENUS` — menus ต่อ role
- `ROLE_ALLOWED_PATHS` — paths ที่อนุญาตต่อ role
- `validateSessionToken(token)` — async, ใช้ Web Crypto

### auth.ts exports
- `validateCredentials(username, password)` — อ่านจาก users.json
- `createSessionToken(user)` — สร้าง signed token
- `getUsers()` — อ่าน users.json (strip BOM อัตโนมัติ)

---

## API Routes

| Route | Method | หน้าที่ |
|---|---|---|
| `/api/auth/login` | POST | validate credentials → set cookie → return `{ ok, role, redirect }` |
| `/api/auth/logout` | POST | clear cookie |
| `/api/auth/me` | GET | return `{ user: { username, role } }` จาก cookie |

---

## Route Protection (proxy.ts)

- ทุก route ต้องมี valid session ยกเว้น `/login` และ `/api/auth/login`
- ถ้าไม่มี session → redirect `/login`
- ถ้ามี session แต่ role ไม่มีสิทธิ์ path นั้น → redirect ไป path แรกที่ role อนุญาต

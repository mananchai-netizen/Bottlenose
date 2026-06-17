# Bottlenose — UI Agent Guide

> Read this file before writing any code in `apps/ui`.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js **16.2.6** (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Runtime | Node.js (API routes) / Edge (proxy) |
| Port | **3100** (`npm run dev`) |

---

## Next.js 16 Breaking Changes

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data.

- **`middleware.ts` is gone** — replaced by `proxy.ts`
- **Export name changed** — must use `export async function proxy()`, not `middleware()`
- Read `node_modules/next/dist/docs/` before writing any code
- Heed all deprecation notices
<!-- END:nextjs-agent-rules -->

---

## Project Structure

```
apps/ui/
├── app/
│   ├── api/
│   │   └── auth/
│   │       ├── login/route.ts    # POST — validate credentials, set cookie
│   │       ├── logout/route.ts   # POST — clear cookie
│   │       └── me/route.ts       # GET — return current session user
│   ├── login/page.tsx            # Login page (public)
│   ├── projects/                 # Projects pages
│   ├── config/                   # Machine config page
│   └── layout.tsx
├── components/
│   └── nav.tsx                   # Role-aware navigation
├── lib/
│   ├── auth-edge.ts              # Edge Runtime auth (proxy.ts only)
│   └── auth.ts                   # Node.js auth (API routes only)
└── proxy.ts                      # Route guard (replaces middleware.ts)
```

---

## Auth System

### Two auth files — never mix them

| File | Runtime | Used by | Can use |
|---|---|---|---|
| `lib/auth-edge.ts` | Edge | `proxy.ts` only | Web Crypto, `atob`, no `fs/os/path` |
| `lib/auth.ts` | Node.js | API routes only | `fs`, `os`, `path`, Node `crypto` |

### Session
- Cookie name: `han_session` (httpOnly, sameSite=lax)
- Token format: `base64url(payload).HMAC-SHA256(payload)`
- TTL: 8 hours
- Secret: `process.env.AUTH_SECRET` (fallback hardcoded for dev)

### Users config
- Path: `~/.han/users.json`
- Format: `[{ "username": "...", "password": "...", "role": "root"|"admin" }]`
- Auto-created if missing (with default accounts)
- **Write without BOM** — use `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` on Windows

---

## Role System

Defined in `lib/auth-edge.ts` — edit here to change access control.

| Role | Menus visible | Allowed paths | Redirect after login |
|---|---|---|---|
| `root` | Status, Config, Projects | `/`, `/config`, `/projects` | `/` |
| `admin` | Projects | `/projects` | `/projects` |

To add a role: update `Role` type, `ROLE_MENUS`, and `ROLE_ALLOWED_PATHS` in `lib/auth-edge.ts`.

---

## Common Pitfalls

1. **Never import `fs/os/path` in `proxy.ts` or `auth-edge.ts`** — Edge Runtime will crash
2. **`Uint8Array.from()` returns `Uint8Array<ArrayBufferLike>`** — Web Crypto requires `Uint8Array<ArrayBuffer>`, use `new Uint8Array(n)` + loop instead
3. **Windows PowerShell `Set-Content -Encoding utf8` adds BOM** — causes `JSON.parse` to throw; use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` instead
4. **`export function middleware` is invalid in Next.js 16** — must be `export function proxy` in `proxy.ts`

---

## Dev Commands

```bash
# Run dev server (port 3100)
npm run dev

# Type check + build
npm run build

# Lint
npm run lint
```

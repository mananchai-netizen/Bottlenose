# Han AI System — CLAUDE.md

> Internal AI-powered Project Operating System.
> Full architecture: `docs/architecture.md` | Build plan: `docs/build-plan.md`

---

## What This Is

Han AI is a distributed agent CLI where multiple machines poll Notion for approved tasks and race to claim them via Redis atomic locks. Each machine runs `han start`, which loops every 30 s, claims a task, executes it with a configured LLM brain, and updates Notion with the result.

```
Human → Notion Tasks → Agent Pool → Output (PR / Doc / Sheet / Slide)
```

---

## Monolith-First Development

We are building the full system in a **single `packages/agent` package** before splitting into distributed services. Do not introduce microservice boundaries, separate servers, or MCP tool packages until Phase 6.

All new code belongs in `packages/agent/src/`.

---

## Repository Layout

```
packages/agent/                 # han CLI + worker package
├── bin/han.js                   # Published CLI entrypoint
├── src/
│   ├── types.ts                 # Core worker types: MachineConfig, HanTask, etc.
│   ├── config.ts                # Read/write ~/.han/config.json + ~/.han/projects.json
│   ├── cli/                     # han init / start / status / ui / demo commands
│   ├── worker/                  # Polling loop, Redis lock, machine registry
│   ├── brains/                  # LLM router and brain adapters
│   ├── executors/               # Task execution: dev/doc/sheet/slide
│   └── integrations/            # Package-level integrations used by worker/demo
│       ├── notion.ts
│       └── google-drive.ts
└── dist/                        # Build output

apps/ui/                         # Next.js project config UI (port 3100)
├── app/                          # App Router pages + API routes
├── components/                   # Shared UI components
└── lib/                          # UI config, registry, shared types

scripts/
└── ensure-notion-task-schema.mjs  # Prepare/repair Notion task database schema

docs/                             # Architecture, build plan, usage notes
```

---

## Build Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Core Foundation | **Done** | `han init`, config, Notion client |
| 2 — Worker Loop | **Done** | Redis atomic claim, heartbeat, polling |
| 3 — Brain Router | **Next** | Gemini + real Anthropic SDK + fallback chain |
| 4 — Task Executors | Planned | `dev` → GitHub PR; doc/sheet/slide |
| 5 — Multi-Machine | Planned | Discord notify, watchdog, permission model |
| 6 — Orion MCP | Planned | MCP tools for Notion, GitHub, Google Workspace |

---

## Dev Commands

```bash
npm run agent:dev       # Run han CLI in watch mode (tsx)
npm run dev             # Run Next.js UI (port 3100)
npm run build           # Build packages/agent + apps/ui
npm run typecheck       # Type-check all packages (strict)
```

---

## Key Types (`packages/agent/src/types.ts`)

```typescript
TaskType   = 'dev' | 'doc' | 'sheet' | 'slide'
TaskStatus = 'New' | 'Approve' | 'In-Progress' | 'Done' | 'Failed'
BrainName  = 'claude-cli' | 'claude-sonnet-4-6' | 'claude-opus-4-7'
           | 'gemini-2.5-pro' | 'gemini-2.0-flash' | 'llm-server'
```

`HanTask` maps to one Notion page. `MachineConfig` lives at `~/.han/config.json`. `ProjectConfig` lives at `~/.han/projects.json` (array, one entry per project).

---

## Notion Task Database Schema

| Property | Notion Type | Notes |
|----------|-------------|-------|
| `title` | Title | Task name |
| `type` | Select | dev / doc / sheet / slide |
| `status` | Select | New → Approve → In-Progress → Done → Failed |
| `priority` | Number | 1 = highest |
| `assigned_to` | Select | machine_id or empty |
| `claimed_by` | Select | machine_id that won the claim |
| `claimed_at` | Date | ISO 8601 timestamp |
| `heartbeat_at` | Date | Updated every 30 s while in-progress |
| `output_url` | URL | PR URL / Doc URL on completion |
| `error_log` | Rich Text | Failure reason |
| `retry_count` | Number | Auto-increments; max 3 then → Failed |
| `brain_used` | Select | e.g. `claude-sonnet-4-6` |
| `context` | Rich Text | Extra instructions for the agent |

---

## Brain Router Pattern

`resolveBrain(config, taskType)` in `brains/router.ts` picks a brain:
1. Check `config.brain[taskType]` (per-type override)
2. Fall back to `config.brain.default`

Currently only `claude-cli` and `llm-server` are wired. Phase 3 adds real Anthropic SDK + Gemini SDK + fallback chain (Claude → Gemini → LLM Server).

Log every brain call: `{ model, input_tokens, output_tokens, duration_ms, task_id }`.

---

## Worker Loop Behaviour

- Polls all projects' Notion DBs every 30 s (adapts up to 120 s when idle, resets to 30 s on task found)
- Claims via Redis `SETNX task:<id>:lock` with TTL 300 s
- Updates Notion status to `In-Progress` immediately after claim, before execution
- On success → `Done` + `output_url`
- On failure → retry up to 3 times (resets to `Approve`); then → `Failed`

---

## Config Files (never commit these)

```
~/.han/config.json     # MachineConfig — API keys, brain, redis_url
~/.han/projects.json   # ProjectConfig[] — notion_db_id, github_repo, etc.
```

---

## UI (apps/ui) — Next.js 16 Critical Rules

- `middleware.ts` **ไม่มีแล้ว** — ใช้ `proxy.ts` แทน
- Export function ต้องชื่อ `proxy` ไม่ใช่ `middleware`
- Edge Runtime (`proxy.ts`, `auth-edge.ts`) **ห้ามใช้** `fs`, `os`, `path`
- Auth แยก 2 ไฟล์: `auth-edge.ts` (proxy เท่านั้น) / `auth.ts` (API routes เท่านั้น)
- Users เก็บใน `~/.han/users.json` — roles: `root` (ทุก menu) / `admin` (Projects เท่านั้น)
- ดูรายละเอียดทั้งหมดที่ `docs/auth.md` และ `apps/ui/AGENTS.md`

---

## Hard Rules

- **Never auto-merge PRs.** Agents push branches and open PRs only. Humans review and merge.
- **No secrets in the repo.** All API keys go in `~/.han/config.json`.
- **Max 3 retries per task.** After that, set status → `Failed` and stop.
- **Adaptive poll interval.** No tight loops — minimum 30 s, maximum 120 s.
- **Log all brain calls.** Needed for cost tracking and debugging.

---

## TypeScript Conventions

- Strict mode — `tsconfig.base.json` applies to all packages
- Use `type` imports for interfaces: `import type { HanTask } from '../types.js'`
- Use `.js` extensions in all import paths (ESM)
- Functions < 50 lines; files < 800 lines
- No `console.log` outside CLI output paths — use `chalk` for coloured CLI output

---

## Notion Integration Notes

- Notion API rate limit: ~3 req/s per integration — the adaptive poll interval protects against this
- `notion_page_id` uses the hyphenated UUID (`page.id`); `task.id` strips hyphens for use as Redis key
- `getApprovedTasks` filters client-side for `assigned_to` and `accept_types` after the Notion query

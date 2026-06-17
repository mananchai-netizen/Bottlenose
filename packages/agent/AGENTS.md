# Bottlenose Agent — Agent Guide

> Read this file before writing any code in `packages/agent`.

---

## What is this package?

`han` CLI + background worker. ติดตั้งบนแต่ละเครื่องที่ต้องการรับงานจาก Notion.

```
han init    → ตั้งค่าเครื่อง (API keys, brain, Redis URL)
han start   → เริ่ม background worker loop
han status  → ดู machine registry + งานที่กำลังทำ
```

---

## Package Structure

```
packages/agent/src/
├── types.ts                  # Core types: MachineConfig, HanTask, TaskType, BrainName
├── config.ts                 # อ่าน/เขียน ~/.han/config.json และ projects.json
├── cli/
│   ├── commands/start.ts     # han start — เริ่ม worker
│   ├── commands/status.ts    # han status — แสดง machine registry
│   ├── commands/ui.ts        # han ui — เปิด browser ไปที่ localhost:3100
│   └── commands/demo.ts      # han demo — demo task
├── worker/
│   ├── machine-registry.ts   # HSET ping online/offline ใน Redis
│   └── redis-lock.ts         # SETNX atomic claim + heartbeat
├── brains/
│   ├── types.ts              # Brain interface: run(req) → BrainResponse
│   └── llm-server.ts         # OpenAI-compat brain (vLLM)
└── executors/
    └── index.ts              # Task executor dispatcher
```

---

## Key Types

```typescript
type TaskType   = 'dev' | 'doc' | 'sheet' | 'slide'
type TaskStatus = 'New' | 'Approve' | 'In-Progress' | 'Done' | 'Failed'
type BrainName  = 'claude-cli' | 'claude-sonnet-4-6' | 'claude-opus-4-7'
                | 'gemini-2.5-pro' | 'gemini-2.0-flash' | 'llm-server'
```

`HanTask` → 1 Notion page
`MachineConfig` → `~/.han/config.json`
`ProjectConfig` → entry ใน `~/.han/projects.json`

---

## Worker Loop Behaviour

```
ทุก 30s (ขยายถึง 120s ตอน idle):
  1. ping Machine Registry (บอกว่า online)
  2. poll Notion tasks ที่ status == Approve
  3. filter ตาม assigned_to และ accept_types
  4. claim ผ่าน Redis SETNX (atomic)
  5. ถ้า claim สำเร็จ → update Notion → In-Progress → execute
  6. heartbeat ทุก 30s ระหว่างทำงาน
  7. update Notion → Done + output_url
  8. ถ้า fail → retry (max 3 ครั้ง) แล้ว → Failed
```

---

## Brain Interface

Brain ทุกตัว implement `Brain` interface เดียวกัน:

```typescript
interface Brain {
  run(req: BrainRequest): Promise<BrainResponse>;
}

interface BrainRequest {
  systemPrompt: string;
  userPrompt: string;
  workspaceDir?: string;
}
```

Brain router เลือกจาก `config.brain[taskType]` → fallback → `config.brain.default`

**Fallback chain:** Claude → Gemini → LLM Server

---

## Config (~/.han/config.json)

```json
{
  "machine_id": "tum-pc",
  "machine_name": "Tum-PC",
  "accept_types": ["dev", "doc"],
  "brain": {
    "default": "claude-sonnet-4-6",
    "dev":     "claude-sonnet-4-6",
    "doc":     "gemini-2.5-pro",
    "sheet":   "llm-server",
    "slide":   "gemini-2.5-pro"
  },
  "notion_token":   "secret_xxx",
  "claude_api_key": "sk-ant-xxx",
  "gemini_api_key": "AIzaSy-xxx",
  "redis_url":      "redis://localhost:6379",
  "poll_interval":  30,
  "max_concurrent_tasks": 1
}
```

---

## TypeScript Conventions

- ESM — ใช้ `.js` extension ใน import path ทุกที่ เช่น `import type { HanTask } from '../types.js'`
- `tsconfig.base.json` strict mode — ห้าม `any`
- `type` imports สำหรับ interface: `import type { ... }`
- Log brain calls ทุกครั้ง: `{ model, input_tokens, output_tokens, duration_ms, task_id }`

---

## Hard Rules

- **ห้าม auto-merge PR** — agent push branch และสร้าง PR เท่านั้น human ต้อง review ก่อน merge
- **ห้าม commit secrets** — API keys เก็บใน `~/.han/config.json` เท่านั้น
- **max 3 retry** — หลังจากนั้น set status → `Failed` หยุด retry
- **Adaptive poll** — ไม่มีงาน → ขยาย interval สูงสุด 120s, มีงาน → reset 30s
- **Monolith-first** — code ใหม่ทั้งหมดอยู่ใน `packages/agent/src/` ยังไม่แยก service

---

## Build & Run

```bash
# Dev mode (watch)
npm run agent:dev

# Build
cd packages/agent && npm run build

# Run CLI
han status
han start
```

---

## Phase Status

| Phase | Status | งาน |
|---|---|---|
| 1 — Core Foundation | Done | `han init`, config, Notion client |
| 2 — Worker Loop | Done | Redis atomic claim, heartbeat, polling |
| 3 — Brain Router | Next | Claude SDK + Gemini SDK + fallback chain |
| 4 — Task Executors | Planned | dev → GitHub PR; doc/sheet/slide |
| 5 — Multi-Machine | Planned | Discord notify, watchdog |
| 6 — Orion MCP | Planned | MCP tools สำหรับ Notion, GitHub, Google Workspace |

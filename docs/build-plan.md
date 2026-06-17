# Han AI System — Build Plan

> วางแผนโดย Jarvis — 2026-05-07

---

## สถานะ Stack

| Layer | Technology | สถานะ |
|-------|-----------|-------|
| Orchestration | Orion OS (MCP) | ✅ มีแล้ว |
| Task Store | Notion API | ❌ ต้องสร้าง |
| Distributed Lock | Redis SETNX | ❌ ต้องสร้าง |
| Machine Registry | Redis HSET | ❌ ต้องสร้าง |
| Brain Router | Claude / Gemini / vLLM | ❌ ต้องสร้าง |
| File/Doc Output | Google Workspace | ❌ ต้องสร้าง |
| Code Output | GitHub | ❌ ต้องสร้าง |
| Notifications | Discord / Telegram / LINE | ❌ ต้องสร้าง |
| Agent CLI | `han` npm package | ❌ ต้องสร้าง |

---

## Phase 1 — Core Foundation

**เป้าหมาย:** `han init` บันทึก config ได้, `han start` เริ่ม polling loop ได้

```
han-agent/
├── src/config.ts          ← อ่าน/เขียน ~/.han/config.json
├── src/notion-client.ts   ← CRUD tasks + status update
└── bin/han                ← han init / han start / han stop / han status / han logs
```

### Checklist

- [ ] สร้าง `han-agent/` package structure
- [ ] `config.ts` — อ่าน/เขียน `~/.han/config.json`
- [ ] `han init` — interactive wizard (machine name, accept_types, API keys)
- [ ] `notion-client.ts` — query tasks by status, update status, attach output_url
- [ ] `han start` / `han stop` / `han status` / `han logs` ผ่าน PM2

### Config Schema (~/.han/config.json)

```json
{
  "machine_id": "tum-pc",
  "machine_name": "Tum-PC",
  "accept_types": ["dev", "doc"],
  "brain": {
    "default": "claude-sonnet-4-6",
    "dev": "claude-sonnet-4-6",
    "doc": "gemini-2.5-pro",
    "sheet": "llm-server",
    "slide": "gemini-2.5-pro"
  },
  "notion_token": "secret_xxx",
  "claude_api_key": "sk-ant-xxx",
  "gemini_api_key": "AIzaSy-xxx",
  "discord_token": "MTxx",
  "llm_server_url": "http://192.168.1.10:8000",
  "redis_url": "redis://192.168.1.10:6379",
  "poll_interval": 30,
  "max_concurrent_tasks": 1
}
```

---

## Phase 2 — Worker Loop + Atomic Claim

**เป้าหมาย:** 1 เครื่อง claim task จาก Notion → update status In-Progress → Done (ยังไม่มี brain จริง)

```
├── src/worker.ts           ← polling loop (adaptive interval)
├── src/redis-lock.ts       ← SETNX claim + TTL 300s + heartbeat 30s
└── src/machine-registry.ts ← HSET ping online/offline
```

### Checklist

- [ ] `redis-lock.ts` — `claim(taskId)` ผ่าน SETNX, `release(taskId)`, `heartbeat(taskId)`
- [ ] `machine-registry.ts` — `register()`, `ping()`, `listOnline()`
- [ ] `worker.ts` — polling loop: query → filter → claim → execute (stub) → done
- [ ] Update Notion status → **In-Progress ทันทีหลัง claim สำเร็จ** (ก่อน execute)
- [ ] Adaptive poll interval: ไม่มีงาน → ขยาย interval สูงสุด 120s, มีงาน → reset 30s
- [ ] `max_concurrent_tasks` check ก่อน claim task ใหม่

### Task Schema (Notion Database)

| Field | Type | หมายเหตุ |
|-------|------|---------|
| `id` | string | task-001 |
| `title` | string | ชื่องาน |
| `type` | select | dev / doc / sheet / slide |
| `status` | select | New → Approve → In-Progress → Done → Failed |
| `priority` | number | 1 = ด่วนสุด |
| `assigned_to` | string | machine_id หรือ null |
| `claimed_by` | string | machine_id |
| `claimed_at` | datetime | |
| `heartbeat_at` | datetime | |
| `output_url` | url | PR URL / Doc URL |
| `error_log` | text | สาเหตุถ้า fail |
| `retry_count` | number | กัน infinite retry |
| `brain_used` | string | claude-sonnet-4-6 |

---

## Phase 3 — Brain Router

**เป้าหมาย:** task `dev` ส่ง prompt → เลือก brain ตาม config → ได้ผล

```
├── src/brain/
│   ├── router.ts       ← เลือก brain ตาม project/task_type config + fallback chain
│   ├── claude.ts       ← Anthropic SDK (claude-sonnet-4-6 / opus-4-7)
│   ├── gemini.ts       ← Google Generative AI (gemini-2.5-pro)
│   └── llm-server.ts   ← OpenAI-compat API → vLLM :8000
```

### Checklist

- [ ] `router.ts` — เลือก brain จาก `brain_per_type` config
- [ ] Fallback chain: Claude → Gemini → LLM Server → notify Discord แล้วใช้ fallback
- [ ] `claude.ts` — Anthropic SDK, log token usage ทุก call
- [ ] `gemini.ts` — Google SDK
- [ ] `llm-server.ts` — fetch OpenAI-compat endpoint
- [ ] Log ทุก brain call: `{ model, input_tokens, output_tokens, duration_ms, task_id }`

---

## Phase 4 — Task Executors

**เป้าหมาย:** end-to-end `dev` task → GitHub PR จริง

```
├── src/executors/
│   ├── dev-executor.ts    ← เขียนโค้ด → commit → push → create PR
│   ├── doc-executor.ts    ← create Google Doc → fill content → share URL
│   ├── sheet-executor.ts  ← create Google Sheet → fill data → share URL
│   └── slide-executor.ts  ← create Google Slides → fill slides → share URL
```

### Checklist

- [ ] `dev-executor.ts` — clone repo → branch `han/<task_id>` → Claude เขียนโค้ด → push → create PR
- [ ] `doc-executor.ts` — Google Docs API → create → fill → return URL
- [ ] `sheet-executor.ts` — Google Sheets API → create → fill → return URL
- [ ] `slide-executor.ts` — Google Slides API → create → fill → return URL
- [ ] ทุก executor แนบ `output_url` กลับไปใน Notion task
- [ ] **ห้าม auto-merge PR** — agent push ได้แค่ PR, human ต้อง review ก่อน

---

## Phase 5 — Multi-Machine + Notifications

**เป้าหมาย:** 2+ เครื่อง claim งานพร้อมกันได้ ไม่ duplicate, Discord แจ้ง Done

```
├── src/discord-bot.ts    ← notify task Done/Failed + command handler
├── src/telegram.ts       ← notify only (optional)
├── src/line.ts           ← notify only (optional)
└── src/watchdog.ts       ← ตรวจ heartbeat timeout → reset task → Approve
```

### Checklist

- [ ] `discord-bot.ts` — notify Done/Failed, commands: `/status`, `/pause`, `/resume`, `/assign`, `/cancel`
- [ ] Discord permission model: `@admin` สั่งได้ทุก machine, `@member` สั่งได้เฉพาะ machine ตัวเอง
- [ ] `watchdog.ts` — cron ทุก 1 นาที: heartbeat > 5 นาที → reset status → Approve
- [ ] Machine offline > 2 นาที → reassign tasks ที่ assigned_to เครื่องนั้น
- [ ] `telegram.ts` + `line.ts` (optional) — notify only, no commands

### Discord Channels

| Channel | หน้าที่ |
|---------|--------|
| `#han-status` | notify task Done ทุก project (ทุกคนอ่านได้) |
| `#han-admin` | สั่งงาน machine (admin เท่านั้น) |
| `#project-<name>` | notify เฉพาะ project นั้น |

---

## Phase 6 — Orion MCP Extension

**เป้าหมาย:** Claude agent เรียก `mcp__orion__notion-*` และ `mcp__orion__github-*` ได้โดยตรง

```
packages/mcp/src/tools/
├── notion-tasks.ts       ← list/create/update tasks
├── google-workspace.ts   ← create doc/sheet/slide
├── github.ts             ← create PR, push code
└── discord-notify.ts     ← send notification
```

### Checklist

- [ ] `notion-tasks.ts` MCP tool — `list_tasks`, `update_task_status`, `attach_output`
- [ ] `github.ts` MCP tool — `create_pr`, `push_branch`
- [ ] `google-workspace.ts` MCP tool — `create_doc`, `create_sheet`, `create_slide`
- [ ] `discord-notify.ts` MCP tool — `send_notification`
- [ ] Register tools ใน `@orion/mcp` server

---

## Timeline (ประมาณการ)

| Phase | งาน | ประมาณเวลา |
|-------|-----|-----------|
| 1 | Core Foundation | 1-2 วัน |
| 2 | Worker Loop + Claim | 2-3 วัน |
| 3 | Brain Router | 1-2 วัน |
| 4 | Dev Executor + GitHub | 2-3 วัน |
| 4 | Doc/Sheet/Slide Executors | 2-3 วัน |
| 5 | Multi-Machine + Discord | 2-3 วัน |
| 6 | Orion MCP Extension | 2-3 วัน |

**รวม MVP (Phase 1-4):** ~2 สัปดาห์
**รวม Production (Phase 1-6):** ~1 เดือน

---

## สิ่งที่ต้องระวัง

- **อย่า auto-merge PR** — agent push code ได้ แต่ human ต้อง review ก่อน merge เสมอ
- **ตั้ง token budget** ต่อ project — กัน API cost บานโดยไม่รู้ตัว
- **Log ทุก brain call** — model, token, เวลา, task_id
- **Notion rate limit** — ~3 req/s ต่อ integration, ใส่ adaptive poll interval
- **Secrets** — API keys เก็บใน `~/.han/config.json` ไม่ push ขึ้น repo
- **retry_count** — กัน task ที่ fail วนไม่สิ้นสุด (max 3 retry แล้ว → Failed)

---

_Plan version 1.0 — Han AI System_
_วางแผนร่วมกับ Jarvis (Claude) — 2026-05-07_

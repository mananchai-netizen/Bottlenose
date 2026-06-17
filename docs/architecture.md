# Han AI System — Architecture

> Internal AI-powered Project Operating System
> วาดโดย Jarvis — 2026-05-07

---

## ภาพรวมระบบ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           HAN AI SYSTEM                                 │
│                                                                         │
│   Human สร้าง Project                                                    │
│        │                                                                │
│        ▼                                                                │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │                    Project Workspace                        │       │
│   │  Notion │ Google Drive │ GitHub │ Discord │ NotebookLM      │       │
│   └───────────────────────────┬─────────────────────────────────┘       │
│                               │                                         │
│        AI อ่าน requirement     │                                         │
│        แล้วแตก tasks ───────→  ▼                                         │
│                          Notion Tasks                                   │
│                     (New → Approve → Done)                              │
│                                │                                        │
│                     Human approve tasks                                 │
│                                │                                        │
│                                ▼                                        │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │                   Agent Worker Pool                         │       │
│   │     Machine-A      Machine-B      Machine-C      Machine-N  │       │
│   │     (Agent)        (Agent)        (Agent)        (Agent)    │       │
│   └───────┬──────────────────┬─────────────────┬─────────────── ┘       │
│           │                  │                 │                        │
│           │   เลือก brain     │   เลือก brain    │   เลือก brain           │
│           ▼                  ▼                 ▼                        │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                       Brain Options                           │     │
│   │                                                               │     │
│   │   ┌─────────────┐   ┌─────────────┐   ┌────────────────────┐  │     │
│   │   │  LLM Server │   │   Claude    │   │   Gemini / อื่นๆ     │  │     │
│   │   │  (กลาง)     │   │ (Anthropic) │   │  (Google / ฯลฯ)    │  │     │
│   │   │ vLLM :8000  │   │ Sonnet/Opus │   │  gemini-2.5-pro    │  │     │
│   │   │ Llama/Mistral│  │             │   │  OpenAI, Groq ฯลฯ  │  │     │
│   │   └─────────────┘   └─────────────┘   └────────────────────┘  │     │
│   │                                                               │     │
│   │   กำหนดต่อ project หรือต่อ task type — fallback อัตโนมัติ           │     │
│   └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │             Central LLM Server (Infrastructure)             │       │
│   │       vLLM Engine │ Redis (lock) │ Machine Registry         │       │
│   └─────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Project Workspace Layer

```
สร้าง Project ใหม่
        │
        ▼
┌──────────────────────────────────────────────────┐
│              Project Setup Wizard                │
│                                                  │
│  ชื่อ Project: ______________________________      │
│                                                  │
│  Integrations:                                   │
│  [x] Google Drive  → folder path (requirements)  │
│  [x] Notion        → workspace URL               │
│  [x] GitHub        → repo URL                    │
│  [x] Discord       → channel ID                  │
│  [x] NotebookLM    → source ID                   │
│  [ ] Telegram      → bot token + chat ID         │
│  [ ] LINE          → channel token + group ID    │
└──────────────────────────┬───────────────────────┘
                       │
                       ▼
            Orion create-workspace
            เก็บ config ใน Nebula
```

---

## 2. Task Lifecycle

```
┌────────────────────────────────────────────────────────────────────┐
│                       Notion Task Board                            │
└────────────────────────────────────────────────────────────────────┘

[New] ──→ Human review ──→ [Approve] ──→ Agent claim ──→ [In-Progress] ──→ [Done]
                                │                              │
                                │                              ▼
                                │                       notify Discord
                                │
                          ┌─────▼───────────────────────────┐
                          │          Task Schema              │
                          │                                   │
                          │  id:           task-001           │
                          │  title:        "Build API"        │
                          │  type:         dev                │
                          │  status:       Approve            │
                          │  priority:     1  (1=ด่วนสุด)       │
                          │  assigned_to:  machine-A          │ ← null = ใครก็ได้
                          │  claimed_by:   -                  │
                          │  claimed_at:   -                  │
                          │  heartbeat_at: -                  │
                          └───────────────────────────────────┘
```

### Task Types

| Type    | Agent ทำอะไร            | Output           |
| ------- | ----------------------- | ---------------- |
| `dev`   | เขียนโค้ด + push GitHub | Pull Request     |
| `doc`   | สร้าง Google Doc        | Document URL     |
| `sheet` | สร้าง Google Sheet      | Sheet URL        |
| `slide` | สร้าง Google Slides     | Presentation URL |

---

## 3. Agent Worker Pool

```
┌────────────────────────────────────────────────────────────────────┐
│                  Agent Worker Loop (ทุกเครื่อง)                       │
│                                                                    │
│  while true:                                                       │
│    1. poll Notion → tasks ที่ status == Approve                      │
│    2. filter:                                                      │
│       - ถ้า assigned_to == my_machine_id  → หยิบก่อน (priority)       │
│       - ถ้า assigned_to == null           → แข่ง claim               │
│       - ถ้า assigned_to == อื่น           → skip                      │
│    3. atomic_claim(task) via Redis SETNX                           │
│       - สำเร็จ  → ทำงาน                                             │
│       - ล้มเหลว → ข้ามไป task ถัดไป                                   │
│    4. execute task ตาม type                                        │
│    5. heartbeat ทุก 30s (บอกว่ายังทำงานอยู่)                            │
│    6. update status → Done + notify Discord                        │
│    7. sleep(poll_interval)                                         │
└────────────────────────────────────────────────────────────────────┘
```

### Task Claim Flow (Atomic)

```
Machine-A                    Redis                    Machine-B
    │                          │                          │
    │── SETNX task:001:lock ──▶│                          │
    │◀── OK ───────────────────│                          │
    │                          │                          │
    │  ทำงาน...                │◀── SETNX task:001:lock ──│ (Machine-B ลอง)
    │                          │──── FAIL ───────────────▶│ skip task นี้
    │                          │                          │
    │── DEL task:001:lock ────▶│                          │
    │  (เสร็จแล้ว)               │                          │
```

### Crash Recovery (Watchdog)

```
ถ้า heartbeat_at เกิน 5 นาที
    → Redis lock หมดอายุ (TTL 300s) อัตโนมัติ
    → task status reset → Approve
    → เครื่องอื่น claim ต่อได้
```

---

## 4. Machine Registry

```
┌──────────────────────────────────────────────────────────────────┐
│                  Machine Registry (Redis)                        │
├────────────┬───────────┬─────────┬────────────┬──────────────────┤
│ machine_id │ name      │ status  │ last_seen  │ accept_types     │
├────────────┼───────────┼─────────┼────────────┼──────────────────┤
│ machine-A  │ Tum-PC    │ online  │ 2s ago     │ dev              │
│ machine-B  │ Han-Mac   │ online  │ 15s ago    │ doc, sheet       │
│ machine-C  │ Mui-Mac   │ online  │ 5s ago     │ dev, slide       │
│ machine-D  │ Office-PC │ offline │ 12min ago  │ doc              │
└────────────┴───────────┴─────────┴────────────┴──────────────────┘

Rule:  last_seen > 2 นาที  →  ถือว่า offline
       ถ้า assigned_to เครื่อง offline  →  reassign อัตโนมัติ
```

แต่ละเครื่อง ping ทุก 30 วินาที:

```
HSET machine:registry  machine-A  { status: online, last_seen: now, accept_types: [dev] }
```

---

## 5. Central LLM Server + Brain Options

```
┌────────────────────────────────────────────────────────────────────┐
│                     Central LLM Server                             │
│                                                                    │
│  ┌───────────────┐   ┌──────────┐   ┌────────────────────────────┐ │
│  │  vLLM Engine  │   │  Redis   │   │     Machine Registry       │ │
│  │ (Local Brain) │   │          │   │                            │ │
│  │               │   │ - locks  │   │ - heartbeat store          │ │
│  │ Llama/Mistral │   │ - queue  │   │ - online/offline           │ │
│  │ Qwen/DeepSeek │   │          │   │                            │ │
│  │               │   │ :6379    │   │ :6379                      │ │
│  │ OpenAI-compat │   └──────────┘   └────────────────────────────┘ │
│  │ API  :8000    │                                                 │
│  └───────────────┘                                                 │
└────────────────────────────────────────────────────────────────────┘
```

### แต่ละเครื่อง Local เลือก Brain ได้เอง

```
                   ┌─────────────────┐
                   │    Machine-A    │
                   │    (Agent)      │
                   └────────┬────────┘
                            │ เลือกสมองตาม config
             ┌──────────────┼──────────────────────┐
             ▼              ▼                       ▼
  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
  │  LLM Server  │  │    Claude    │  │    Gemini / อื่นๆ    │
  │  (กลาง)      │  │ (Anthropic)  │  │   (Google / ฯลฯ)   │
  │              │  │              │  │                    │
  │ vLLM :8000   │  │ sonnet-4.6   │  │ gemini-2.5-pro     │
  │ Llama/Mistral│  │ opus-4.7     │  │ gemini-2.0-flash   │
  │              │  │              │  │                    │
  │ + ฟรี/private │  │ + code ดี     │  │ + context ยาว      │
  │ - ช้ากว่า      │  │ + ฉลาดสุด     │  │ + multimodal       │
  └──────────────┘  └──────────────┘  └────────────────────┘
         + provider อื่นๆ ได้อีก (OpenAI, Groq, Cohere ฯลฯ)
```

### กำหนด Brain ต่อ Project หรือต่อ Task Type ได้

```yaml
project: "Alpha"
default_brain: claude-sonnet-4.6

brain_per_type:
  dev: claude-sonnet-4.6 # เขียนโค้ด → Claude เก่งสุด
  doc: gemini-2.5-pro # เขียน doc ยาว → Gemini context ยาว
  sheet: llm-server # สร้าง sheet → ใช้ local ประหยัด
  slide: gemini-2.5-pro # layout + multimodal → Gemini
```

### Agent Code (เหมือนกันทุกเครื่อง — Router จัดการให้)

```python
response = brain.complete(
    project   = "Alpha",
    task_type = "dev",
    messages  = [{"role": "user", "content": prompt}]
)
# Router เลือก Claude / Gemini / LLM Server ให้อัตโนมัติ
```

### Fallback Chain (ถ้า brain หลักมีปัญหา)

```
Claude API หมด quota / ล่ม
        │
        ▼
  ลอง Gemini API
        │  ล่มอีก?
        ▼
  ใช้ LLM Server (local)
  งานไม่หยุด — แจ้ง Discord ว่า fallback
```

### Concurrent Load (ประมาณการ LLM Server)

| GPU             | Model | Agent พร้อมกัน |
| --------------- | ----- | -------------- |
| RTX 4090 (24GB) | 13B   | ~8 agents      |
| 2x RTX 4090     | 32B   | ~15 agents     |
| A100 (80GB)     | 70B   | ~20 agents     |

---

## 6. Integration Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                       Integration Layer                         │
│                                                                 │
│  ┌──────────────┐  ┌────────────┐  ┌──────────┐  ┌───────────┐  │
│  │   Google     │  │   Notion   │  │  GitHub  │  │  Discord  │  │
│  │  Workspace   │  │            │  │          │  │           │  │
│  │ - Drive      │  │ - Tasks DB │  │ - Repos  │  │ - Notify  │  │
│  │ - Docs       │  │ - Machine  │  │ - PRs    │  │ - Commands│  │
│  │ - Sheets     │  │   Registry │  │ - Issues │  │ - Status  │  │
│  │ - Slides     │  │ - Project  │  │          │  │           │  │
│  │              │  │   Config   │  │          │  │           │  │
│  └──────────────┘  └────────────┘  └──────────┘  └───────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────────────────┐  │
│  │  NotebookLM  │  │  Telegram  │  │          LINE           │  │
│  │              │  │ (optional) │  │        (optional)       │  │
│  │ - knowledge  │  │            │  │                         │  │
│  │   base/RAG   │  │ - notify   │  │ - notify only           │  │
│  │ - project    │  │   only     │  │                         │  │
│  │   Q&A        │  │            │  │                         │  │
│  └──────────────┘  └────────────┘  └─────────────────────────┘  │
│                                                                 │
│  ทุก integration ถูก wrap เป็น MCP tools                           │
│  Agent เรียกผ่าน tool call ได้เลย                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Full System Flow

```
1. สร้าง Project
   Human → Project Setup Wizard
        → create-workspace (Orion)
        → connect Google Drive / Notion / GitHub / Discord

2. แตก Requirements เป็น Tasks
   Human ใส่ requirement ใน Google Drive folder
        → AI อ่านไฟล์
        → แตกเป็น tasks ใน Notion (status: New)

3. Human Approve
   Human review tasks ใน Notion
        → เปลี่ยน status: New → Approve
        → (optional) set assigned_to, priority, brain

4. Agent หยิบงาน
   Agent loop ทุกเครื่อง poll tasks status == Approve
        → claim task via Redis (atomic)
        → update status → In-Progress

5. Execute ตาม Type
   type dev   → เขียนโค้ด → commit → push GitHub → PR
   type doc   → create Google Doc → fill content → share URL
   type sheet → create Google Sheet → fill data → share URL
   type slide → create Google Slides → fill slides → share URL

6. Done
   Agent update status → Done
        → แนบ output URL ใน task
        → notify Discord "#project-channel"
        → Human review ผล

7. Crash Recovery
   Watchdog ตรวจ heartbeat ทุก 1 นาที
        → task ค้างเกิน 5 นาที → reset → Approve
        → Machine offline เกิน 2 นาที → reassign assigned tasks
```

---

## 8. Tech Stack

| Layer            | Technology                | หน้าที่                 |
| ---------------- | ------------------------- | ----------------------- |
| Orchestration    | Orion OS (MCP)            | brain, memory, skills   |
| Task Store       | Notion API                | tasks, project config   |
| Distributed Lock | Redis (SETNX)             | atomic claim            |
| Machine Registry | Redis HSET                | online/offline tracking |
| LLM Engine       | vLLM                      | inference, batching     |
| LLM APIs         | Claude / Gemini / OpenAI  | cloud brain options     |
| File Storage     | Google Drive              | requirements, assets    |
| Documents        | Google Docs/Sheets/Slides | task output             |
| Code             | GitHub                    | dev task output         |
| Knowledge Base   | NotebookLM                | project Q&A, RAG        |
| Notifications    | Discord / Telegram / LINE | status updates          |
| Agent Runtime    | Claude Code + MCP         | task execution          |

---

## 9. Orion Extension Points

สิ่งที่ต้องเพิ่มเข้า Orion:

```
orion-os/
├── mcp/
│   ├── tools/
│   │   ├── notion-tasks.ts      ← CRUD tasks + status machine
│   │   ├── machine-registry.ts  ← heartbeat, online check
│   │   ├── task-claim.ts        ← atomic claim via Redis
│   │   ├── google-workspace.ts  ← create doc/sheet/slide
│   │   ├── github.ts            ← create PR, push code
│   │   ├── notebooklm.ts        ← sync knowledge, query RAG
│   │   ├── discord-notify.ts    ← send notifications + commands
│   │   ├── telegram-notify.ts   ← notify only (optional)
│   │   └── line-notify.ts       ← notify only (optional)
│   └── skills/
│       ├── requirement-parser   ← อ่าน folder → แตก tasks
│       ├── dev-executor         ← type dev
│       ├── doc-executor         ← type doc
│       ├── sheet-executor       ← type sheet
│       └── slide-executor       ← type slide
└── agents/
    └── worker-loop.ts           ← poll → claim → execute
```

---

## 10. Recommendations

### เริ่ม Build ยังไง (ลำดับที่แนะนำ)

| ลำดับ | สิ่งที่ทำ                             | เหตุผล                                        |
| ----- | ------------------------------------- | --------------------------------------------- |
| 1     | Notion Tasks DB + status machine      | core ของระบบทั้งหมด                           |
| 2     | Worker loop + Redis claim (1 เครื่อง) | ทดสอบ flow ก่อนขยาย                           |
| 3     | Brain router (Claude ก่อน)            | ใช้ Claude เป็น default ก่อน เพิ่ม LLM ทีหลัง |
| 4     | dev-executor + GitHub integration     | ทดสอบ task type แรก                           |
| 5     | doc/sheet/slide executor              | ทยอย wire ทีละ type                           |
| 6     | เพิ่ม machine หลายเครื่อง             | ทดสอบ concurrent claim                        |
| 7     | เพิ่ม local LLM server                | เมื่อ scale ใหญ่ขึ้นและต้องการลด cost         |

### GPU Server

```
สำหรับ internal team < 20 คน:
  RTX 4090 (24GB) x1  +  Llama-3 13B  →  พอสบาย, ราคาประหยัด

สำหรับ team ขนาดกลาง หรืองาน code ซับซ้อน:
  RTX 4090 (24GB) x2  +  Qwen2.5 32B  →  คุณภาพดี, concurrent สูงขึ้น

ถ้าไม่มี GPU server ก่อน:
  ใช้ Claude API + Gemini API ล้วน → ไม่ต้องซื้อ hardware เลย
  แล้วค่อย migrate ไป local LLM เมื่อ volume สูงพอ
```

### สิ่งที่ต้องระวัง

- **อย่า auto-merge PR** — agent push code ได้ แต่ human ต้อง review ก่อน merge เสมอ
- **ตั้ง token budget** ต่อ project — กันค่า API บาน โดยไม่รู้ตัว
- **Log ทุก brain call** — model, token, เวลา, task id — ช่วยมากเวลา debug และ optimize cost
- **Notion rate limit** — Notion API อนุญาต ~3 req/s ต่อ integration ถ้า agent เยอะให้ใส่ queue
- **Secrets management** — API keys ของ Claude/Gemini/GitHub เก็บใน env ไม่ใส่ใน code

### ต่อยอดจาก Orion ได้เลย

```
มีอยู่แล้ว (ไม่ต้องเขียนใหม่):
  [x] create-workspace
  [x] Nebula (knowledge store ต่อ project)
  [x] State management (Redis)
  [x] Skill/Agent system

ต้องเขียนใหม่:
  [ ] Notion MCP tools
  [ ] Brain router
  [ ] Google Workspace MCP tools
  [ ] Worker loop agent
  [ ] Discord notify tool
```

---

## 11. Installation & Setup (ต่อแต่ละเครื่อง)

### Package Structure

```
han-agent/          ← npm package ที่ลงได้ทุกเครื่อง
├── bin/
│   └── han         ← CLI entrypoint
├── src/
│   ├── worker.ts   ← background polling loop
│   ├── brain.ts    ← LLM router
│   ├── executors/  ← dev, doc, sheet, slide
│   └── config.ts   ← อ่าน .han/config.json
└── package.json
```

### ลง Package ครั้งแรก (ทำครั้งเดียวต่อเครื่อง)

```bash
# option A — npm global
npm install -g han-agent

# option B — curl installer (ง่ายสุด)
curl -fsSL https://han.internal/install.sh | bash
```

### Setup เครื่องใหม่

```bash
han init
```

```
? Machine name:          Tum-PC
? Accept task types:     dev, doc
? Brain (default):       claude
? Notion API key:        secret_xxx...
? Claude API key:        sk-ant-xxx...
? Discord Bot token:     MTxx...
? LLM Server URL:        http://192.168.1.10:8000  (optional)

✓ Config saved to ~/.han/config.json
✓ Registered to Machine Registry
✓ Ready to start
```

### เริ่ม / หยุด Worker

```bash
han start          # เริ่ม background worker (ใช้ PM2)
han stop           # หยุด
han restart        # restart
han status         # ดู status + งานที่กำลังทำ
han logs           # ดู log realtime
```

### Full Setup Flow (ภาพรวม)

```
เครื่องใหม่
    │
    ▼
npm install -g han-agent
    │
    ▼
han init
    ├── ใส่ machine name + accept_types
    ├── ใส่ API keys (Notion, Claude, Discord)
    └── (optional) ใส่ LLM Server URL
    │
    ▼
han start
    ├── register ตัวเองใน Machine Registry (Redis)
    ├── เริ่ม background worker loop
    └── เริ่ม heartbeat ping ทุก 30s
    │
    ▼
เครื่องออนไลน์ พร้อมรับงาน
```

### Config File (~/.han/config.json)

```json
{
  "machine_id": "tum-pc",
  "machine_name": "Tum-PC",
  "accept_types": ["dev", "doc"],
  "brain": {
    "default": "claude-sonnet-4.6",
    "dev": "claude-sonnet-4.6",
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
  "poll_interval": 30
}
```

---

## 12. Background Agent — วิธีทำงาน 24/7

### Agent ทำงานได้สองแบบ

```
แบบ A: Polling Loop (แนะนำ)        แบบ B: Event-driven (advanced)

  ทุก 30 วินาที                       Notion webhook → trigger ทันที
  poll Notion → มีงานไหม?             เร็วกว่า แต่ต้องมี public URL
  ถ้ามี → claim → ทำงาน              เหมาะถ้ามี server กลาง

  → ง่ายกว่า, ไม่ต้องการ             → latency ต่ำ แต่ซับซ้อนกว่า
    public endpoint                    ต้องตั้ง webhook ต่อ project
```

### Polling Loop (แบบ A) — วิธีทำงาน

```
han start
    │
    ▼
PM2 / systemd รัน worker.ts เป็น daemon
    │
    ▼
┌──────────────────────────────────────────────────────┐
│                  Worker Background Loop              │
│                                                      │
│  loop ทุก 30 วินาที:                                    │
│                                                      │
│  1. ping Machine Registry  (บอกว่า online)            │
│                                                      │
│  2. query Notion:                                    │
│     status == Approve                                │
│     AND (assigned_to == me OR assigned_to == null)   │
│     ORDER BY priority ASC                            │
│                                                      │
│  3. ถ้ามี task:                                        │
│     → atomic_claim(task) via Redis SETNX             │
│     → ถ้า claim สำเร็จ → execute(task)                 │
│     → heartbeat ทุก 30s ระหว่างทำงาน                   │
│     → update Notion status → Done                    │
│     → notify Discord                                 │
│                                                      │
│  4. ถ้าไม่มี task:                                      │
│     → sleep(30s) แล้ว loop ใหม่                        │
└──────────────────────────────────────────────────────┘
```

### Process Manager — ใช้ PM2

```bash
# han start ทำสิ่งเหล่านี้ให้อัตโนมัติ:
pm2 start worker.js --name "han-agent" --restart-delay 3000
pm2 save
pm2 startup    # auto-start เมื่อเปิดเครื่อง
```

```
PM2 จัดการ:
  ✓ restart อัตโนมัติถ้า process crash
  ✓ auto-start เมื่อ reboot เครื่อง
  ✓ เก็บ log ไว้ดูย้อนหลัง
  ✓ ดู CPU/memory usage
```

### Notification & Command Channels

```
┌─────────────────────────────────────────────────────────────────┐
│                   Notification Channels                         │
│                                                                 │
│   Discord (หลัก)     Telegram (optional)    LINE (optional)      │
│   ────────────────   ──────────────────     ────────────────    │
│   - สั่งงาน          - notify เท่านั้น       - notify เท่านั้น          │
│   - ดู status        - ไม่มี command        - ไม่มี command          │
│   - notify           - เหมาะถ้าทีม          - เหมาะถ้าทีม           │
│                        ใช้ Telegram          ใช้ LINE             │
└─────────────────────────────────────────────────────────────────┘
```

### Discord — Permission Model

ปัญหา: ถ้าไม่มี permission → เจ้าของ Machine-A ไปสั่ง pause Machine-B ได้

```
Discord Roles:
  @admin     → สั่งได้ทุก machine
  @member    → สั่งได้เฉพาะ machine ของตัวเอง

Machine Registry เก็บ owner:
  machine-A  owner: discord_user_id: 123456   (Tum)
  machine-B  owner: discord_user_id: 789012   (Han)
```

```
Command              @admin   @member (owner)   @member (ไม่ใช่ owner)
────────────────────────────────────────────────────────────────────
/status              ดูได้    ดูเฉพาะของตัว     ดูเฉพาะของตัว
/pause tum-pc        ได้      ได้ (ถ้าเป็น Tum)  ❌ Permission denied
/resume tum-pc       ได้      ได้ (ถ้าเป็น Tum)  ❌ Permission denied
/assign task tum-pc  ได้      ❌ admin only       ❌ admin only
/cancel task         ได้      ❌ admin only       ❌ admin only
```

### Discord Channels Structure

```
Discord Server
├── #han-status          ← bot แจ้ง task Done ทุก project (ทุกคนอ่านได้)
├── #han-admin           ← สั่งงาน machine (admin เท่านั้น)
└── #project-alpha       ← notify เฉพาะ project Alpha
    #project-beta        ← notify เฉพาะ project Beta
```

```
Human พิมพ์ใน #han-admin:          Bot ตอบกลับ:

/status                        →   Machine Registry:
                                   tum-pc:    online | task-042 (dev) in-progress
                                   han-mac:   online | ว่าง
                                   office-pc: offline (12 นาที)

/pause tum-pc    (โดย Tum)     →   [OK] tum-pc หยุดรับงานใหม่
/pause tum-pc    (โดย Han)     →   [DENIED] tum-pc เป็นของ Tum เท่านั้น

/assign task-055 tum-pc        →   [OK] task-055 assigned → tum-pc  (@admin เท่านั้น)
/cancel task-055               →   [OK] task-055 reset → Approve    (@admin เท่านั้น)
```

### Telegram (Optional) — Notify เท่านั้น

```bash
# ตั้งใน han init หรือเพิ่มทีหลัง:
han config set telegram_bot_token  "7xxxxx:AAF..."
han config set telegram_chat_id    "-100xxxxxxx"   # group chat id
```

```
เมื่อ task Done → bot ส่งไปใน Telegram group:

  ✅ task-042 เสร็จแล้ว
  ─────────────────────
  Project:  Alpha
  Title:    Build Login API
  Type:     dev
  Machine:  tum-pc
  Output:   github.com/alpha/pr/12
  เวลา:     3m 42s
```

### LINE (Optional) — Notify เท่านั้น

```bash
han config set line_channel_token  "xxxx..."
han config set line_group_id       "Cxxxx..."
```

```
เมื่อ task Done → bot ส่งไปใน LINE Group:

  [HAN] task เสร็จแล้ว
  Project: Alpha
  task-042: Build Login API
  → PR: github.com/alpha/pr/12
```

### สรุป Channel Matrix

| Channel  | สั่งงาน | ดู status | รับ notify | Permission |
| -------- | ------- | --------- | ---------- | ---------- |
| Discord  | ✓       | ✓         | ✓          | role-based |
| Telegram | ✗       | ✗         | ✓          | -          |
| LINE     | ✗       | ✗         | ✓          | -          |

> **แนะนำ:** ใช้ Discord เป็น command center, แล้ว forward notify ไป Telegram/LINE ถ้าทีมใช้อยู่แล้ว

### ภาพรวม Agent Lifecycle

```
เปิดเครื่อง
    │
    ▼
PM2 auto-start han-agent
    │
    ▼
Register ตัวเองใน Machine Registry
    │
    ▼
Background Loop เริ่มทำงาน ─────────────────────────────┐
    │                                                 │
    │  ทุก 30s                                         │
    ├── ping Redis (heartbeat)                        │
    ├── poll Notion (มีงานไหม?)                        │
    │       │                                         │
    │   มีงาน│                                         │
    │       ▼                                         │
    │   claim via Redis ─── ล้มเหลว ──→ loop ต่อ ───────┘
    │       │ สำเร็จ
    │       ▼
    │   execute task
    │       │
    │       ▼
    │   update Notion → Done
    │       │
    │       ▼
    │   notify Discord ─────────────────────────────────┐
    │                                                   │
    └────────────────────────────────────────────────── ┘
         loop ต่อเรื่อยๆ จนกว่าจะ han stop หรือปิดเครื่อง
```

---

_Architecture version 0.3 — Han AI System_
_วาดร่วมกับ Jarvis (Claude) — 2026-05-07_

# Han AI System

> Internal AI-powered Project Operating System — Multi-machine agent worker pool with Notion task management

## Overview

Han AI is a distributed agent system where multiple machines collaborate to execute tasks automatically. Human creates and approves tasks in Notion, then agent workers across all registered machines race to claim and execute them — writing code, creating documents, or producing spreadsheets and presentations.

```
Human → Notion Tasks → Agent Pool → Output (PR / Doc / Sheet / Slide)
```

## Repository Structure

```
han-ai/
├── apps/
│   └── ui/                   # Next.js config & project management UI
├── packages/
│   └── agent/                # han CLI + worker (npm package)
│       ├── bin/han.js         # CLI entrypoint
│       └── src/
│           ├── types.ts           # Core types (MachineConfig, HanTask, etc.)
│           ├── config.ts          # Read/write ~/.han/config.json
│           ├── cli/               # han init / start / status / ui commands
│           ├── worker/            # Polling loop, Redis lock, machine registry
│           ├── brains/            # LLM router (Claude, Gemini, LLM Server)
│           ├── executors/         # Task executors (dev, doc, sheet, slide)
│           └── integrations/      # Notion client
├── docs/
│   ├── architecture.md        # Full system architecture
│   ├── build-plan.md          # Phase 1-6 build plan
│   └── session-2026-05-08.md  # Session summary
├── package.json               # npm workspaces root
└── tsconfig.base.json         # Strict TypeScript base config
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Task Store | Notion API |
| Distributed Lock | Redis (SETNX) |
| Machine Registry | Redis HSET |
| LLM Brains | Claude (Anthropic) / Gemini (Google) / vLLM (local) |
| Code Output | GitHub (PR) |
| Document Output | Google Docs / Sheets / Slides |
| Notifications | Discord / Telegram / LINE |
| Config UI | Next.js 16 + Tailwind CSS 4 |
| CLI | Node.js + Commander + Inquirer |

## Prerequisites

- Node.js 20+
- Redis (local: `localhost:6379` or Upstash for production)
- Notion account + integration token
- At least one AI API key (Claude, Gemini) or a local vLLM server

## Installation

```bash
# Install from npm (coming soon)
npm install -g han-agent

# Or run from this repo
npm install
npm run build
```

## Setup

Run the interactive setup wizard on each machine:

```bash
han init
```

You will be prompted for:

```
? Machine name:       Tum-PC
? Accept task types:  dev, doc
? Brain (default):    claude
? Notion API key:     secret_xxx...
? Claude API key:     sk-ant-xxx...
? Redis URL:          redis://localhost:6379
? LLM Server URL:     http://192.168.1.10:8000  (optional)
```

Config is saved to `~/.han/config.json`. Project configs are stored in `~/.han/projects.json`.

## Usage

```bash
han start     # Start background worker (polls Notion every 30s)
han stop      # Stop worker
han status    # Show machine registry + current tasks
han ui        # Open web UI (Next.js)
```

## Task Lifecycle

```
[New] → Human review → [Approve] → Agent claim → [In-Progress] → [Done]
```

| Task Type | What agent does | Output |
|-----------|----------------|--------|
| `dev` | Write code → commit → push → create PR | GitHub Pull Request URL |
| `doc` | Create and fill Google Doc | Google Docs URL |
| `sheet` | Create and fill Google Sheet | Google Sheets URL |
| `slide` | Create Google Slides presentation | Google Slides URL |

## Multi-Machine Claim (Atomic)

Each machine polls Notion for `Approve` tasks and races to claim via Redis `SETNX`. Only one machine wins per task — no duplicate execution.

- **Heartbeat**: claimed machine pings Redis every 30s
- **Crash recovery**: if heartbeat stops for 5 min, Redis lock expires and task resets to `Approve`
- **Offline detection**: machine missing from registry for 2+ min triggers reassignment of its tasks

## Brain Configuration

Each machine and project can select its AI brain per task type:

```json
{
  "brain": {
    "default": "claude-sonnet-4-6",
    "dev":   "claude-sonnet-4-6",
    "doc":   "gemini-2.5-pro",
    "sheet": "llm-server",
    "slide": "gemini-2.5-pro"
  }
}
```

Available brains: `claude-cli`, `claude-sonnet-4-6`, `claude-opus-4-7`, `gemini-2.5-pro`, `gemini-2.0-flash`, `llm-server`

**Fallback chain**: Claude API → Gemini API → Local LLM Server — work never stops.

## Development

```bash
# Run agent CLI in dev mode
npm run agent:dev

# Run UI in dev mode
npm run dev

# Type check all packages
npm run typecheck

# Build everything
npm run build
```

## Build Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Core Foundation | Done | `han init`, config, Notion client |
| 2 — Worker Loop | Done | Redis atomic claim, heartbeat, polling |
| 3 — Brain Router | Next | Claude / Gemini / LLM Server + fallback |
| 4 — Task Executors | Planned | `dev` → GitHub PR; doc/sheet/slide |
| 5 — Multi-Machine | Planned | Discord notify, watchdog, permission model |
| 6 — Orion MCP | Planned | MCP tools for Notion, GitHub, Google Workspace |

## Security Notes

- **Never auto-merge PRs** — agents push code but humans must review before merge
- API keys are stored in `~/.han/config.json` and never committed to the repository
- Set per-project token budgets to avoid unexpected API costs
- All brain calls are logged: model, token count, duration, task ID

## License

Private — internal use only

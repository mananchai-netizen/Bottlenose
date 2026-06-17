# Environment Variables

> รวม env vars ทั้งหมดของ Bottlenose

---

## apps/ui (Next.js)

สร้างไฟล์ `apps/ui/.env.local` (ไม่ commit ขึ้น repo)

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_SECRET` | แนะนำ | `han-ai-internal-secret-2024` | Secret สำหรับ sign session token — เปลี่ยนใน production เสมอ |

**ตัวอย่าง `apps/ui/.env.local`:**
```env
AUTH_SECRET=your-random-secret-string-here
```

> ถ้าไม่กำหนด `AUTH_SECRET` ระบบจะใช้ค่า hardcoded — ใช้ได้สำหรับ dev แต่ไม่ปลอดภัยใน production

---

## packages/agent (han CLI)

Agent ใช้ config ใน `~/.han/config.json` แทน env vars โดยตรง

| Config Key | Description |
|---|---|
| `notion_token` | Notion Integration Token (`secret_xxx`) |
| `claude_api_key` | Anthropic API Key (`sk-ant-xxx`) |
| `gemini_api_key` | Google Gemini API Key (`AIzaSy-xxx`) |
| `discord_token` | Discord Bot Token |
| `redis_url` | Redis connection URL (default: `redis://localhost:6379`) |
| `llm_server_url` | vLLM server URL (optional, e.g. `http://192.168.1.10:8000`) |

ดูรายละเอียดทั้งหมดที่ `~/.han/config.json` schema ใน `docs/architecture.md`

---

## Redis

| ใช้สำหรับ | Default |
|---|---|
| Distributed task lock (`SETNX`) | `redis://localhost:6379` |
| Machine Registry (`HSET`) | `redis://localhost:6379` |

กำหนดผ่าน `redis_url` ใน `~/.han/config.json` หรือ env var `REDIS_URL` (ถ้า deploy บน cloud)

---

## Production Checklist

- [ ] กำหนด `AUTH_SECRET` ใน environment (ไม่ใช้ค่า default)
- [ ] ใช้ Redis ที่มี persistence (ไม่ใช่ in-memory เฉยๆ) หรือ Upstash Redis
- [ ] ไม่ commit `apps/ui/.env.local` หรือ `~/.han/config.json` ขึ้น repo
- [ ] ตั้ง `REDIS_URL` ถ้า Redis ไม่ได้รันที่ localhost

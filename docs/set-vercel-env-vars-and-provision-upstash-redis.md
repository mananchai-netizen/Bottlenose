# Plan: Set Vercel Env Vars + Provision Upstash Redis

## Context

The `apps/ui/app/api/han/poll/route.ts` cron handler is deployed but not yet operational.
It requires six env vars to run. `REDIS_URL` must come from Upstash (TLS `rediss://` URL).
All other vars come from existing secrets you already hold.

---

## Step 1 — Provision Upstash Redis (get REDIS_URL)

1. Open **https://console.upstash.com** → Sign in (or sign up free).
2. Click **"Create Database"**.
3. Fill in:
   - **Name**: `han-ai` (or any name)
   - **Type**: Regional
   - **Region**: pick the one closest to your Vercel deployment (e.g. `us-east-1`)
   - **TLS**: leave **enabled** (default)
4. Click **"Create"**.
5. After creation, go to the database detail page → **"REST API"** tab is shown by default.
   Switch to the **"ioredis / Node.js"** or **"Details"** section.
6. Copy the **"Redis URL"** that starts with `rediss://` (the one with `default:...@...upstash.io:6379`).
   — This is your `REDIS_URL` value. Save it.

---

## Step 2 — Open Vercel Project Environment Variables

1. Go to **https://vercel.com/dashboard** → select your project (the one hosting `apps/ui`).
2. Click **"Settings"** tab → **"Environment Variables"** in the left sidebar.
3. You will add 6 variables. For each one:
   - Click **"Add New"**
   - Enter the **Key** and **Value**
   - Set **Environment** to **Production** (and optionally Preview/Development)
   - Click **"Save"**

---

## Step 3 — Add each env var

### 3a. NOTION_TOKEN
- **Key**: `NOTION_TOKEN`
- **Value**: Your Notion integration secret token.
  - Where to find it: https://www.notion.so/profile/integrations → open your integration → copy "Internal Integration Secret" (starts with `secret_...`)

### 3b. REDIS_URL
- **Key**: `REDIS_URL`
- **Value**: The `rediss://` URL copied from Upstash Step 1.6 above.
  - Format: `rediss://default:<password>@<host>.upstash.io:6379`

### 3c. HAN_PROJECTS_JSON
- **Key**: `HAN_PROJECTS_JSON`
- **Value**: A JSON array of your projects. Each entry needs `notion_db_id` and optionally `google_drive_folder_id`.
  - Example (one project, no Drive):
    ```
    [{"notion_db_id":"YOUR-NOTION-DB-ID-HERE"}]
    ```
  - Example (one project with Drive folder):
    ```
    [{"notion_db_id":"YOUR-NOTION-DB-ID","google_drive_folder_id":"YOUR-DRIVE-FOLDER-ID"}]
    ```
  - The `notion_db_id` is the UUID from the Notion database URL: `notion.so/<workspace>/<DATABASE_ID>?v=...`
  - The `google_drive_folder_id` is the folder ID from the Drive URL: `drive.google.com/drive/folders/<FOLDER_ID>`

### 3d. ANTHROPIC_API_KEY
- **Key**: `ANTHROPIC_API_KEY`
- **Value**: Your Anthropic API key (starts with `sk-ant-...`).
  - Where to find it: https://console.anthropic.com/settings/keys

### 3e. GOOGLE_SERVICE_ACCOUNT_JSON
- **Key**: `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Value**: The **entire contents** of your Google service account JSON key file, pasted as a single-line string.
  - Where to find it: Google Cloud Console → IAM & Admin → Service Accounts → select your account → Keys → Add Key → JSON. Download the `.json` file.
  - Paste the whole JSON content (including `{` and `}`) as the value. Vercel accepts multi-line but single-line is safer.
  - Make sure the service account has been shared on the Google Drive folders it needs to read.

### 3f. CRON_SECRET
- **Key**: `CRON_SECRET`
- **Value**: A strong random secret string you generate.
  - Generate one: run `openssl rand -hex 32` in your terminal, or use any password generator.
  - Vercel will automatically inject this as `Bearer <CRON_SECRET>` in the `Authorization` header when calling `/api/han/poll` from the cron schedule. The route validates it at line 294-299 of `route.ts`.
  - Save this value — you'll need it if you ever manually call the endpoint.

---

## Step 4 — Redeploy

After setting all 6 vars:
1. Go to the **"Deployments"** tab in your Vercel project.
2. Click **"..."** on the latest deployment → **"Redeploy"** (to pick up the new env vars).
3. Wait for build to complete.

---

## Step 5 — Verify

1. **Check the cron is registered**: Vercel dashboard → **"Settings"** → **"Crons"** — you should see `/api/han/poll` with schedule `* * * * *`.
2. **Trigger manually**: In Vercel Crons tab, click **"Run Now"** on the cron entry (or use the Vercel CLI: `vercel cron trigger /api/han/poll`).
3. **Check logs**: Vercel dashboard → **"Logs"** → filter by function `/api/han/poll`. You should see either:
   - `{"status":"no_tasks"}` — route is working, no approved tasks found.
   - `{"status":"completed","task_id":"..."}` — a task was claimed and executed.
   - Any `500` with an error message pointing to which env var is wrong.
4. **Create a test task in Notion**: Add a page to your Notion DB with `status = Approve` and `type = doc`. Wait up to 60 seconds for the next cron tick, or trigger manually.

---

## Critical Files (reference)

| File | Role |
|------|------|
| `apps/ui/app/api/han/poll/route.ts` | The cron handler — reads all 6 env vars |
| `apps/ui/vercel.json` | Cron schedule (`* * * * *` = every minute) |

# Google Drive Integration — Demo Guide

> How to run the `han demo` command against a real Drive folder, without needing Notion or Redis.

---

## TL;DR

| What you need | Where to get it |
|---|---|
| Service-account JSON key | Google Cloud Console → IAM & Admin → Service Accounts |
| Folder ID | Drive URL — the string after `/folders/` |
| Folder shared with service account | Right-click folder → Share → paste the SA email |

---

## Step 1 — Create a service-account key

### 1a. Create a Google Cloud project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Name it (e.g. `han-ai`) and click **Create**

### 1b. Enable required APIs

In your project, go to **APIs & Services → Enable APIs and Services** and enable all four:

- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API

### 1c. Create the service account and download the key

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**
2. Name it (e.g. `han-agent`), click **Create and Continue → Done**
3. Click the service account you just created → **Keys** tab
4. **Add Key → Create new key → JSON** → download the `.json` file
5. Save it somewhere safe, e.g. `~/.han/service-account.json`

### 1d. Add `google_key_path` to your Han config

Edit `~/.han/config.json` and add the field:

```json
{
  "google_key_path": "/Users/you/.han/service-account.json",
  "brain": { "default": "claude-cli" }
}
```

The path must point to the `.json` file you downloaded in step 1c.

---

## Step 2 — Find your folder ID

Open Google Drive in your browser and navigate to the target folder. The URL looks like:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz12345
```

The folder ID is the long string after `/folders/` — copy it.

> **From a shared link:** Right-click the folder → **Share** → **Copy link** → the ID is the segment between `/folders/` and `?`.

---

## Step 3 — Share the folder with the service account

> This is the most commonly missed step. Skip it and you'll get an empty file list.

1. In Drive, right-click the folder → **Share**
2. Paste the service account email in the "Add people and groups" field
   - Find it in the downloaded JSON under `"client_email"` — looks like `han-agent@han-ai.iam.gserviceaccount.com`
3. Set role to **Viewer** → click **Send**

---

## Step 4 — Run the demo

```bash
# List all supported files (Docs, Sheets, Slides) in the folder
npm run agent:dev -- demo --folder-id 1AbCdEfGhIjKlMnOpQrStUvWxYz12345

# Filter to Docs only, skip the brain step
npm run agent:dev -- demo --folder-id <id> --type doc --no-brain

# Filter to Sheets and send a task to the brain
npm run agent:dev -- demo --folder-id <id> --type sheet --task "Summarize each row"

# Filter to Slides only
npm run agent:dev -- demo --folder-id <id> --type slide
```

**Expected output:**

```
[demo] Listing files in folder: 1AbCdEfGhIjKlMnOpQrStUvWxYz12345
[demo] Found 3 file(s)
  • Q2 Report (doc)
  • Budget 2026 (sheet)
  • Product Deck (slide)
[demo] Reading: Q2 Report ...
[demo] Done
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Empty file list (`Found 0 file(s)`) | Folder not shared with the service account | Repeat Step 3 |
| `403 Forbidden` | Required API not enabled, or wrong project | Check Step 1b; confirm the key belongs to the same project |
| `Could not load the default credentials` | `google_key_path` missing or wrong path | Check `~/.han/config.json` and confirm the file exists |

/**
 * Register Google Drive Push Notification Watch
 * รัน: node scripts/register-drive-watch.mjs
 * ต้องรันหลัง deploy ครั้งแรก และทุกครั้งที่ domain เปลี่ยน
 */

import { config } from 'dotenv'
import path from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { google } from 'googleapis'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '..', 'apps', 'ui', '.env.local') })

// ── ตรวจ env vars ────────────────────────────────────────────────────────────
const required = ['GOOGLE_OAUTH_CLIENT_JSON', 'GOOGLE_OAUTH_TOKEN_PATH', 'APP_URL', 'DRIVE_WEBHOOK_SECRET', 'HAN_PROJECTS_JSON']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌  ${key} ไม่ได้ตั้งค่าใน apps/ui/.env.local`)
    process.exit(1)
  }
}

const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
if (!existsSync(tokenPath)) {
  console.error(`❌  OAuth token file not found: ${tokenPath}`)
  console.error('    รัน: node scripts/google-reauth.mjs ก่อน')
  process.exit(1)
}

// ── สร้าง Drive auth ─────────────────────────────────────────────────────────
const credentials = JSON.parse(process.env.GOOGLE_OAUTH_CLIENT_JSON)
const clientConfig = credentials.installed ?? credentials.web
const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret)
oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')))

const drive = google.drive({ version: 'v3', auth: oauth2 })

// ── อ่าน projects ─────────────────────────────────────────────────────────────
const projects = JSON.parse(process.env.HAN_PROJECTS_JSON)
const folders = projects.filter((p) => p.google_drive_folder_id)

if (folders.length === 0) {
  console.error('❌  ไม่มี project ที่มี google_drive_folder_id')
  process.exit(1)
}

const webhookUrl    = `${process.env.APP_URL}/api/drive/webhook`
const webhookSecret = process.env.DRIVE_WEBHOOK_SECRET
const expiration    = Date.now() + 6 * 24 * 60 * 60 * 1000  // 6 วัน

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Register Google Drive Watch')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Webhook URL :', webhookUrl)
console.log('  Projects    :', folders.length)
console.log()

const records = []

for (const project of folders) {
  const folderId  = project.google_drive_folder_id
  const channelId = randomUUID()

  try {
    const res = await drive.files.watch({
      fileId: folderId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: webhookSecret,
        expiration: String(expiration),
      },
    })

    const record = {
      folderId,
      channelId,
      resourceId: res.data.resourceId ?? '',
    }
    records.push(record)

    console.log(`✅  ${project.project_name ?? folderId}`)
    console.log(`    channelId  : ${channelId}`)
    console.log(`    resourceId : ${res.data.resourceId}`)
    console.log(`    expires    : ${new Date(expiration).toLocaleString('th-TH')}`)
    console.log()
  } catch (err) {
    console.error(`❌  ${project.project_name ?? folderId}: ${err.message}`)
    console.log()
  }
}

if (records.length > 0) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  เพิ่ม env var นี้ใน .env.local และ Vercel Dashboard:')
  console.log()
  console.log(`  DRIVE_CHANNEL_RECORDS='${JSON.stringify(records)}'`)
  console.log()
  console.log('  Watch จะหมดอายุใน 6 วัน — ระบบจะต่ออายุอัตโนมัติผ่าน Cron')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

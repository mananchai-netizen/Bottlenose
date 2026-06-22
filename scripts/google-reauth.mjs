/**
 * Google OAuth Re-authorization
 * รัน: node scripts/google-reauth.mjs
 * ใช้เมื่อเกิด invalid_grant หรือ token หมดอายุ
 */

import { config } from 'dotenv'
import path from 'node:path'
import http from 'node:http'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { google } from 'googleapis'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '..', 'apps', 'ui', '.env.local') })

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
]

const CALLBACK_PORT = 53682
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/oauth2callback`

// ── ตรวจ env vars ────────────────────────────────────────────────────────────
const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON
const tokenPath  = process.env.GOOGLE_OAUTH_TOKEN_PATH

if (!clientJson) {
  console.error('❌  GOOGLE_OAUTH_CLIENT_JSON ไม่ได้ตั้งค่าใน apps/ui/.env.local')
  process.exit(1)
}
if (!tokenPath) {
  console.error('❌  GOOGLE_OAUTH_TOKEN_PATH ไม่ได้ตั้งค่าใน apps/ui/.env.local')
  process.exit(1)
}

const credentials = JSON.parse(clientJson)
const clientConfig = credentials.installed ?? credentials.web
if (!clientConfig?.client_id || !clientConfig?.client_secret) {
  console.error('❌  GOOGLE_OAUTH_CLIENT_JSON ไม่ถูกต้อง')
  process.exit(1)
}

const oauth2 = new google.auth.OAuth2(
  clientConfig.client_id,
  clientConfig.client_secret,
  REDIRECT_URI,
)

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
})

// ── เปิด local server รับ callback ──────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Google OAuth Re-authorization')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('\n1. เปิด URL นี้ในเบราว์เซอร์:\n')
console.log('  ', authUrl)
console.log('\n2. Login และกด Allow')
console.log('3. รอ script บันทึก token อัตโนมัติ...\n')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`)
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404); res.end(); return
  }

  const code  = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>❌ ล้มเหลว: ${error ?? 'ไม่ได้รับ code'}</h2>`)
    console.error('❌  Authorization ล้มเหลว:', error ?? 'ไม่ได้รับ code')
    server.close()
    process.exit(1)
  }

  try {
    const { tokens } = await oauth2.getToken(code)
    writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf8')

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<html><body style="font-family:sans-serif;padding:2rem;background:#0f1117;color:#e2e8f0">
      <h2 style="color:#34d399">✅ Authorization สำเร็จ!</h2>
      <p>Token บันทึกที่: <code>${tokenPath}</code></p>
      <p>ปิดหน้าต่างนี้ได้เลย</p>
    </body></html>`)

    console.log('✅  Token ใหม่บันทึกแล้วที่:', tokenPath)
    if (!tokens.refresh_token) {
      console.warn('⚠️   ไม่ได้รับ refresh_token — ถ้าเกิดปัญหาอีกให้ revoke access ใน')
      console.warn('     https://myaccount.google.com/permissions แล้วรัน script นี้ใหม่')
    }
    console.log('\nเสร็จสิ้น — ลองรัน Plan Tasks ได้เลย\n')
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>❌ แลก token ล้มเหลว</h2><pre>${err.message}</pre>`)
    console.error('❌  แลก token ล้มเหลว:', err.message)
  } finally {
    server.close()
  }
})

server.listen(CALLBACK_PORT, '127.0.0.1', () => {
  console.log(`   (รอรับ callback ที่ port ${CALLBACK_PORT}...)`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌  Port ${CALLBACK_PORT} ถูกใช้อยู่ — ปิด process อื่นก่อนแล้วลองใหม่`)
  } else {
    console.error('❌  Server error:', err.message)
  }
  process.exit(1)
})

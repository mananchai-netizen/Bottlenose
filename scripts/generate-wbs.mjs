import ExcelJS from 'exceljs'

const wb = new ExcelJS.Workbook()
wb.creator = 'Han AI'
wb.created = new Date()

// ─── Color palette ───────────────────────────────────────────────────
const COLOR = {
  RED:    'FFFF4444',
  YELLOW: 'FFFFC107',
  GREEN:  'FF4CAF50',
  BLUE:   'FF1565C0',
  HEADER_BG: 'FF1565C0',
  HEADER_FG: 'FFFFFFFF',
  SPRINT1: 'FFFFE0E0',
  SPRINT2: 'FFFFF3E0',
  SPRINT3: 'FFE8F5E9',
  SPRINT4: 'FFE3F2FD',
  ROW_ALT: 'FFF5F5F5',
  ROW_WHITE: 'FFFFFFFF',
}

const PRIORITY = {
  'วิกฤต': { bg: 'FFFF4444', fg: 'FFFFFFFF' },
  'สูง':   { bg: 'FFFFC107', fg: 'FF000000' },
  'กลาง':  { bg: 'FF4CAF50', fg: 'FFFFFFFF' },
  'ต่ำ':   { bg: 'FF90CAF9', fg: 'FF000000' },
}

const SPRINT_COLOR = {
  'Sprint 1': { bg: 'FFFFE0E0', badge: 'FFFF4444' },
  'Sprint 2': { bg: 'FFFFF3E0', badge: 'FFFFC107' },
  'Sprint 3': { bg: 'FFE8F5E9', badge: 'FF4CAF50' },
  'Sprint 4': { bg: 'FFE3F2FD', badge: 'FF1565C0' },
}

function headerStyle(bgColor = COLOR.HEADER_BG) {
  return {
    font: { bold: true, color: { argb: COLOR.HEADER_FG }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: {
      bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
    },
  }
}

function cellStyle(bgColor = COLOR.ROW_WHITE) {
  return {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } },
    alignment: { vertical: 'middle', wrapText: true },
    border: {
      bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
    },
  }
}

function applyStyle(cell, style) {
  if (style.font) cell.font = style.font
  if (style.fill) cell.fill = style.fill
  if (style.alignment) cell.alignment = style.alignment
  if (style.border) cell.border = style.border
}

// ════════════════════════════════════════════════════════════════════
// Sheet 1 — WBS Overview
// ════════════════════════════════════════════════════════════════════
const ws1 = wb.addWorksheet('📋 WBS Overview', {
  views: [{ state: 'frozen', ySplit: 3 }],
  properties: { tabColor: { argb: 'FF1565C0' } },
})

ws1.columns = [
  { key: 'id',       width: 8  },
  { key: 'sprint',   width: 12 },
  { key: 'category', width: 28 },
  { key: 'task',     width: 50 },
  { key: 'file',     width: 38 },
  { key: 'priority', width: 12 },
  { key: 'status',   width: 14 },
  { key: 'days',     width: 10 },
]

// Title row
ws1.mergeCells('A1:H1')
const titleCell = ws1.getCell('A1')
titleCell.value = 'HAN AI SYSTEM — Work Breakdown Structure'
titleCell.font = { bold: true, size: 16, color: { argb: COLOR.HEADER_FG } }
titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.HEADER_BG } }
titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
ws1.getRow(1).height = 36

// Subtitle
ws1.mergeCells('A2:H2')
const subtitleCell = ws1.getCell('A2')
subtitleCell.value = 'เป้าหมาย: ทำระบบให้สมบูรณ์และนำไปใช้งานได้จริงทุก function'
subtitleCell.font = { italic: true, size: 11, color: { argb: 'FF555555' } }
subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }
subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' }
ws1.getRow(2).height = 22

// Header row
const headers = ['#', 'Sprint', 'หมวด', 'งาน', 'ไฟล์ที่แก้', 'Priority', 'Status', 'วัน']
const headerRow = ws1.getRow(3)
headers.forEach((h, i) => {
  const cell = headerRow.getCell(i + 1)
  cell.value = h
  applyStyle(cell, headerStyle())
})
headerRow.height = 28

// ─── Data ────────────────────────────────────────────────────────────
const tasks = [
  // Sprint 1
  ['A1', 'Sprint 1', 'A — Data Persistence', 'getMachineConfig() อ่านจาก Neon DB (machine_config table)',         'apps/ui/lib/config.ts',                        'วิกฤต', '⬜ Todo', 0.5],
  ['A2', 'Sprint 1', 'A — Data Persistence', 'saveMachineConfig() บันทึกลง Neon DB (แทน no-op)',                  'apps/ui/lib/config.ts',                        'วิกฤต', '⬜ Todo', 0.5],
  ['A3', 'Sprint 1', 'A — Data Persistence', 'getProjects() อ่านจาก Neon DB (project_configs table)',             'apps/ui/lib/config.ts',                        'วิกฤต', '⬜ Todo', 0.5],
  ['A4', 'Sprint 1', 'A — Data Persistence', 'saveProject() บันทึกลง Neon DB (แทน no-op)',                       'apps/ui/lib/config.ts',                        'วิกฤต', '⬜ Todo', 0.5],
  ['A5', 'Sprint 1', 'A — Data Persistence', 'deleteProject() ลบจาก Neon DB (แทน no-op)',                        'apps/ui/lib/config.ts',                        'วิกฤต', '⬜ Todo', 0.5],
  ['A6', 'Sprint 1', 'A — Data Persistence', 'getUsers() อ่านจาก Neon DB (users table) แทน users.json',          'apps/ui/lib/auth.ts',                          'วิกฤต', '⬜ Todo', 0.5],
  ['A7', 'Sprint 1', 'A — Data Persistence', 'saveUser() บันทึกลง Neon DB (แทน filesystem)',                     'apps/ui/lib/auth.ts',                          'วิกฤต', '⬜ Todo', 0.5],
  ['A8', 'Sprint 1', 'A — Data Persistence', 'deleteUser() ลบจาก Neon DB',                                       'apps/ui/lib/auth.ts',                          'วิกฤต', '⬜ Todo', 0.5],
  ['A11','Sprint 1', 'A — Data Persistence', 'ensureSchema() เรียก auto ตอน app start',                          'apps/ui/lib/db.ts',                            'วิกฤต', '⬜ Todo', 0.5],
  ['B1', 'Sprint 1', 'B — Env Variables',    'ปิด Vercel Deployment Protection',                                 'Vercel Dashboard',                             'วิกฤต', '⬜ Todo', 0.2],
  ['B2', 'Sprint 1', 'B — Env Variables',    'ตั้ง CRON_SECRET, APP_URL, DATABASE_URL',                           'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['B3', 'Sprint 1', 'B — Env Variables',    'ตั้ง NOTION_TOKEN',                                                'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['B4', 'Sprint 1', 'B — Env Variables',    'ตั้ง REDIS_URL',                                                   'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['B5', 'Sprint 1', 'B — Env Variables',    'ตั้ง HAN_MACHINE_ID, HAN_BRAIN',                                   'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['B6', 'Sprint 1', 'B — Env Variables',    'ตั้ง HAN_PROJECTS_JSON',                                           'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['B7', 'Sprint 1', 'B — Env Variables',    'ตั้ง brain key (ANTHROPIC_API_KEY หรือ QWEN/OPENROUTER)',           'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['F1', 'Sprint 1', 'F — Webhook',          'Notion webhook รับได้จริง (ต่อจาก B1)',                            'Vercel Dashboard + Notion',                    'วิกฤต', '⬜ Todo', 0.3],
  ['F2', 'Sprint 1', 'F — Webhook',          'ตั้ง NOTION_WEBHOOK_VERIFICATION_TOKEN หลัง verify',               'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  ['F3', 'Sprint 1', 'F — Webhook',          'ตรวจสอบ APP_URL ถูกต้อง → after() เรียก poll ได้',                 'Vercel env vars',                              'วิกฤต', '⬜ Todo', 0.2],
  // Sprint 2
  ['A9', 'Sprint 2', 'A — Data Persistence', 'Hash passwords ด้วย bcrypt แทนเก็บ plaintext',                    'apps/ui/lib/auth.ts',                          'สูง',   '⬜ Todo', 0.5],
  ['A10','Sprint 2', 'A — Data Persistence', 'Seed default users ใน Neon ครั้งแรก (ถ้า table ว่าง)',             'apps/ui/lib/auth.ts',                          'สูง',   '⬜ Todo', 0.5],
  ['E1', 'Sprint 2', 'E — Security',         'ลบ default passwords hardcode (root1234, admin123) ออกจาก code',  'apps/ui/lib/auth.ts',                          'สูง',   '⬜ Todo', 0.3],
  ['E2', 'Sprint 2', 'E — Security',         'Hash passwords bcrypt ก่อนบันทึก (ต่อจาก A9)',                    'apps/ui/lib/auth.ts',                          'สูง',   '⬜ Todo', 0.3],
  ['E3', 'Sprint 2', 'E — Security',         'First-run wizard: บังคับตั้ง password ใหม่ถ้า Neon ว่าง',         'apps/ui/app/login/page.tsx',                   'สูง',   '⬜ Todo', 1.0],
  ['E4', 'Sprint 2', 'E — Security',         'AUTH_SECRET ต้องตั้งใน env ไม่ใช่ hardcode fallback',             'apps/ui/lib/auth.ts',                          'สูง',   '⬜ Todo', 0.3],
  ['C1', 'Sprint 2', 'C — Web UI',           'หน้า Config — save ลง Neon ได้จริง (ต่อจาก A1-A2)',              'apps/ui/app/config/page.tsx',                  'สูง',   '⬜ Todo', 0.5],
  ['C2', 'Sprint 2', 'C — Web UI',           'หน้า Projects — save/delete ลง Neon ได้จริง (ต่อจาก A3-A5)',     'apps/ui/app/projects/page.tsx',                'สูง',   '⬜ Todo', 0.5],
  ['C3', 'Sprint 2', 'C — Web UI',           'หน้า Users — save/delete ลง Neon ได้จริง (ต่อจาก A6-A8)',        'apps/ui/app/users/page.tsx',                   'สูง',   '⬜ Todo', 0.5],
  ['D3', 'Sprint 2', 'D — Worker/Executor',  'callBrain() return { text, brainUsed } แทน string เปล่า',         'apps/ui/lib/call-brain.ts',                    'สูง',   '⬜ Todo', 0.5],
  // Sprint 3
  ['D1', 'Sprint 3', 'D — Worker/Executor',  'บันทึก task_outputs ลง Neon หลัง execute เสร็จ',                 'apps/ui/app/api/han/poll/route.ts + dev/route', 'กลาง',  '⬜ Todo', 1.0],
  ['D2', 'Sprint 3', 'D — Worker/Executor',  'บันทึก task_logs (step logs) ระหว่าง execute',                   'apps/ui/app/api/han/poll/route.ts + dev/route', 'กลาง',  '⬜ Todo', 1.0],
  ['D5', 'Sprint 3', 'D — Worker/Executor',  'poll route อ่าน projects จาก Neon แทน env var (ต่อจาก A3)',      'apps/ui/app/api/han/poll/route.ts',            'กลาง',  '⬜ Todo', 0.5],
  ['D6', 'Sprint 3', 'D — Worker/Executor',  'Google OAuth token อ่านจาก env GOOGLE_OAUTH_TOKEN_JSON',          'apps/ui/app/api/han/poll/route.ts',            'กลาง',  '⬜ Todo', 0.5],
  ['C4', 'Sprint 3', 'C — Web UI',           'หน้า Projects — ดู task_logs ของแต่ละ task',                     'apps/ui/app/projects/[id]/page.tsx',           'กลาง',  '⬜ Todo', 1.0],
  ['C5', 'Sprint 3', 'C — Web UI',           'หน้า Projects — ดู task_outputs ของแต่ละ task',                  'apps/ui/app/projects/[id]/page.tsx',           'กลาง',  '⬜ Todo', 1.0],
  ['C6', 'Sprint 3', 'C — Web UI',           'หน้า Machines — แสดง online/offline realtime จาก Redis',         'apps/ui/app/machines/page.tsx (ใหม่)',          'กลาง',  '⬜ Todo', 1.0],
  // Sprint 4
  ['D4', 'Sprint 4', 'D — Worker/Executor',  'implement Gemini SDK จริง (gemini-2.5-pro / flash)',              'packages/agent/src/brains/router.ts',          'ต่ำ',   '⬜ Todo', 1.0],
  ['B8', 'Sprint 4', 'B — Env Variables',    'ตั้ง GOOGLE_OAUTH_CLIENT_JSON + GOOGLE_OAUTH_TOKEN_JSON',         'Vercel env vars',                              'กลาง',  '⬜ Todo', 0.5],
  ['B9', 'Sprint 4', 'B — Env Variables',    'ตั้ง GITHUB_TOKEN',                                              'Vercel env vars',                              'กลาง',  '⬜ Todo', 0.2],
  ['B10','Sprint 4', 'B — Env Variables',    'ตั้ง LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET',            'Vercel env vars',                              'ต่ำ',   '⬜ Todo', 0.2],
  ['C7', 'Sprint 4', 'C — Web UI',           'หน้า Config — section RunPod config (บันทึกลง runpod_config)',   'apps/ui/app/config/page.tsx',                  'ต่ำ',   '⬜ Todo', 1.0],
]

let rowIdx = 4
tasks.forEach((t, i) => {
  const [id, sprint, category, task, file, priority, status, days] = t
  const row = ws1.getRow(rowIdx)
  row.values = [id, sprint, category, task, file, priority, status, days]
  row.height = 30

  const sprintColor = SPRINT_COLOR[sprint] ?? { bg: COLOR.ROW_WHITE, badge: COLOR.BLUE }
  const bg = i % 2 === 0 ? sprintColor.bg : lighten(sprintColor.bg)

  row.eachCell((cell, colNumber) => {
    applyStyle(cell, cellStyle(bg))
    if (colNumber === 1) {
      cell.font = { bold: true, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    if (colNumber === 6) {
      const p = PRIORITY[priority] ?? { bg: 'FFE0E0E0', fg: 'FF000000' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p.bg } }
      cell.font = { bold: true, color: { argb: p.fg }, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    if (colNumber === 7) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    if (colNumber === 8) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.numFmt = '0.0'
    }
  })
  rowIdx++
})

// Total row
ws1.getRow(rowIdx).values = ['', '', '', '', '', '', 'รวม', tasks.reduce((s, t) => s + t[7], 0)]
const totalRow = ws1.getRow(rowIdx)
totalRow.height = 26
totalRow.eachCell((cell, col) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } }
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  cell.alignment = { horizontal: col === 8 ? 'center' : 'right', vertical: 'middle' }
})

// ════════════════════════════════════════════════════════════════════
// Sheet 2 — Sprint Plan
// ════════════════════════════════════════════════════════════════════
const ws2 = wb.addWorksheet('🗓 Sprint Plan', {
  views: [{ state: 'frozen', ySplit: 3 }],
  properties: { tabColor: { argb: 'FF4CAF50' } },
})

ws2.columns = [
  { key: 'sprint',   width: 14 },
  { key: 'goal',     width: 40 },
  { key: 'tasks',    width: 10 },
  { key: 'days',     width: 10 },
  { key: 'items',    width: 70 },
]

ws2.mergeCells('A1:E1')
const s2Title = ws2.getCell('A1')
s2Title.value = 'HAN AI — Sprint Plan'
s2Title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
s2Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }
s2Title.alignment = { horizontal: 'center', vertical: 'middle' }
ws2.getRow(1).height = 36

const s2Headers = ['Sprint', 'เป้าหมาย', 'จำนวนงาน', 'วันโดยประมาณ', 'รายการงาน']
const s2HeaderRow = ws2.getRow(2)
s2Headers.forEach((h, i) => {
  const cell = s2HeaderRow.getCell(i + 1)
  cell.value = h
  applyStyle(cell, headerStyle('FF2E7D32'))
})
ws2.getRow(2).height = 28

const sprints = [
  {
    sprint: 'Sprint 1',
    goal: 'ระบบทำงานได้บน Vercel — webhook รับได้, poll ทำงาน',
    days: '1-2 วัน',
    color: 'FFFFE0E0',
    items: 'A1-A11: Config/Projects/Users → Neon\nB1-B7: ตั้ง env vars ที่จำเป็น\nF1-F3: Webhook + Notion verify',
  },
  {
    sprint: 'Sprint 2',
    goal: 'Security + Web UI บันทึก/แก้ไขได้จริง',
    days: '1-2 วัน',
    color: 'FFFFF3E0',
    items: 'A9-A10: Password hashing + seed users\nE1-E4: Security fixes (remove hardcode, bcrypt, first-run)\nC1-C3: หน้า Config/Projects/Users ใช้งานได้จริง\nD3: callBrain return brainUsed',
  },
  {
    sprint: 'Sprint 3',
    goal: 'Logs + Monitoring — ดู task output/logs ได้ใน UI',
    days: '1-2 วัน',
    color: 'FFE8F5E9',
    items: 'D1-D2: บันทึก task_outputs + task_logs ลง Neon\nD5-D6: Poll อ่าน projects + Google OAuth จาก Neon\nC4-C5: หน้าดู task logs/outputs\nC6: หน้า Machines realtime',
  },
  {
    sprint: 'Sprint 4',
    goal: 'Brain & Integrations ครบ — Gemini, Google, GitHub, LINE',
    days: '1-2 วัน',
    color: 'FFE3F2FD',
    items: 'D4: Gemini SDK จริง (gemini-2.5-pro)\nB8-B10: Google OAuth / GitHub / LINE env vars\nC7: RunPod config UI\n(optional) Discord bot notify',
  },
]

const sprintTaskCount = { 'Sprint 1': 0, 'Sprint 2': 0, 'Sprint 3': 0, 'Sprint 4': 0 }
tasks.forEach(t => { sprintTaskCount[t[1]] = (sprintTaskCount[t[1]] || 0) + 1 })

sprints.forEach((s, i) => {
  const row = ws2.getRow(i + 3)
  row.values = [s.sprint, s.goal, sprintTaskCount[s.sprint] || 0, s.days, s.items]
  row.height = 80
  row.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.color } }
    cell.alignment = { vertical: 'top', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
    if (col === 1) cell.font = { bold: true, size: 12 }
    if (col === 3 || col === 4) cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
})

// ════════════════════════════════════════════════════════════════════
// Sheet 3 — Env Variables Checklist
// ════════════════════════════════════════════════════════════════════
const ws3 = wb.addWorksheet('🔑 Env Variables', {
  views: [{ state: 'frozen', ySplit: 3 }],
  properties: { tabColor: { argb: 'FFFF9800' } },
})

ws3.columns = [
  { key: 'var',       width: 36 },
  { key: 'desc',      width: 42 },
  { key: 'required',  width: 14 },
  { key: 'sprint',    width: 12 },
  { key: 'example',   width: 42 },
  { key: 'done',      width: 10 },
]

ws3.mergeCells('A1:F1')
const s3Title = ws3.getCell('A1')
s3Title.value = 'HAN AI — Vercel Environment Variables Checklist'
s3Title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
s3Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE65100' } }
s3Title.alignment = { horizontal: 'center', vertical: 'middle' }
ws3.getRow(1).height = 36

const s3Headers = ['Variable', 'คำอธิบาย', 'Required', 'Sprint', 'ตัวอย่างค่า', 'Done']
const s3HeaderRow = ws3.getRow(2)
s3Headers.forEach((h, i) => {
  const cell = s3HeaderRow.getCell(i + 1)
  cell.value = h
  applyStyle(cell, headerStyle('FFE65100'))
})
ws3.getRow(2).height = 28

const envVars = [
  ['CRON_SECRET',                     'secret สำหรับ /api/han/poll (Bearer token)',        'Required', 'Sprint 1', 'random-secret-32chars',                   '⬜'],
  ['APP_URL',                          'URL ของ Vercel deployment',                         'Required', 'Sprint 1', 'https://xxx.vercel.app',                  '⬜'],
  ['DATABASE_URL',                     'Neon PostgreSQL connection string',                 'Required', 'Sprint 1', 'postgresql://user:pass@ep-xxx.neon.tech/db','⬜'],
  ['NOTION_TOKEN',                     'Notion Integration API token',                      'Required', 'Sprint 1', 'ntn_xxxxxxxxxxxxxxxxxx',                   '⬜'],
  ['REDIS_URL',                        'Upstash Redis URL',                                 'Required', 'Sprint 1', 'rediss://default:xxx@xxx.upstash.io:6379', '⬜'],
  ['HAN_MACHINE_ID',                   'machine id ของ Vercel worker',                      'Required', 'Sprint 1', 'vercel-worker',                            '⬜'],
  ['HAN_BRAIN',                        'brain default: qwen-runpod / openrouter / claude',  'Required', 'Sprint 1', 'qwen-runpod',                              '⬜'],
  ['HAN_PROJECTS_JSON',                'JSON array ของ projects config',                    'Required', 'Sprint 1', '[{"project_id":"p1","notion_db_id":"xxx"}]','⬜'],
  ['AUTH_SECRET',                      'secret สำหรับ sign session token',                  'Required', 'Sprint 2', 'random-secret-64chars',                   '⬜'],
  ['ANTHROPIC_API_KEY',                'Claude API key (ถ้าใช้ claude brain)',               'Situational','Sprint 1','sk-ant-api-xxxxx',                       '⬜'],
  ['QWEN_RUNPOD_URL',                  'RunPod Serverless endpoint URL',                    'Situational','Sprint 1','https://api.runpod.ai/v2/xxx/runsync',    '⬜'],
  ['QWEN_RUNPOD_TOKEN',                'RunPod API token',                                  'Situational','Sprint 1','rpa_xxxxxxxxx',                           '⬜'],
  ['QWEN_MODEL_NAME',                  'Qwen model name บน RunPod',                         'Optional',  'Sprint 1','Qwen/Qwen2.5-7B-Instruct-AWQ',            '⬜'],
  ['OPENROUTER_API_KEY',               'OpenRouter API key',                                'Situational','Sprint 1','sk-or-v1-xxxxxxxxx',                      '⬜'],
  ['OPENROUTER_MODEL',                 'OpenRouter model id',                               'Optional',  'Sprint 1','anthropic/claude-3.5-sonnet',              '⬜'],
  ['GOOGLE_OAUTH_CLIENT_JSON',         'Google OAuth client JSON (stringified)',             'Situational','Sprint 4','{"installed":{"client_id":"...","client_secret":"..."}}','⬜'],
  ['GOOGLE_OAUTH_TOKEN_JSON',          'Google OAuth token JSON (stringified)',              'Situational','Sprint 4','{"access_token":"ya29...","refresh_token":"1//..."}','⬜'],
  ['GITHUB_TOKEN',                     'GitHub Personal Access Token สำหรับ dev tasks',     'Situational','Sprint 4','github_pat_xxxxxxxxx',                    '⬜'],
  ['LINE_CHANNEL_ACCESS_TOKEN',        'LINE Messaging API Channel Access Token',           'Optional',  'Sprint 4','xxxxxxxxxxxxxxxxxxxxxx',                   '⬜'],
  ['LINE_CHANNEL_SECRET',              'LINE Channel Secret',                               'Optional',  'Sprint 4','xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',         '⬜'],
  ['NOTION_WEBHOOK_VERIFICATION_TOKEN','Token จาก Notion webhook verify',                  'Required',  'Sprint 1','notion-webhook-verify-token',              '⬜'],
]

envVars.forEach((ev, i) => {
  const row = ws3.getRow(i + 3)
  row.values = ev
  row.height = 24
  const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFFFF8F0'
  row.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } }
    if (col === 1) cell.font = { bold: true, name: 'Courier New', size: 10 }
    if (col === 3) {
      const colors = { 'Required': 'FFFF4444', 'Situational': 'FFFFC107', 'Optional': 'FF4CAF50' }
      const textColors = { 'Required': 'FFFFFFFF', 'Situational': 'FF000000', 'Optional': 'FFFFFFFF' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[ev[2]] ?? 'FFE0E0E0' } }
      cell.font = { bold: true, color: { argb: textColors[ev[2]] ?? 'FF000000' }, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
    if (col === 6) cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
})

// ════════════════════════════════════════════════════════════════════
// Sheet 4 — Summary Dashboard
// ════════════════════════════════════════════════════════════════════
const ws4 = wb.addWorksheet('📊 Summary', {
  properties: { tabColor: { argb: 'FF9C27B0' } },
})

ws4.columns = [
  { key: 'label', width: 26 },
  { key: 'value', width: 20 },
]

ws4.mergeCells('A1:B1')
const s4Title = ws4.getCell('A1')
s4Title.value = 'HAN AI — Project Summary'
s4Title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
s4Title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6A1B9A' } }
s4Title.alignment = { horizontal: 'center', vertical: 'middle' }
ws4.getRow(1).height = 36

const summaryData = [
  ['', ''],
  ['📋 ภาพรวม', ''],
  ['งานทั้งหมด', `${tasks.length} tasks`],
  ['ระยะเวลาประมาณ', `${tasks.reduce((s, t) => s + t[7], 0).toFixed(1)} วัน`],
  ['จำนวน Sprint', '4 sprints'],
  ['', ''],
  ['🔴 Priority', ''],
  ['วิกฤต (Critical)', `${tasks.filter(t => t[5] === 'วิกฤต').length} tasks`],
  ['สูง (High)', `${tasks.filter(t => t[5] === 'สูง').length} tasks`],
  ['กลาง (Medium)', `${tasks.filter(t => t[5] === 'กลาง').length} tasks`],
  ['ต่ำ (Low)', `${tasks.filter(t => t[5] === 'ต่ำ').length} tasks`],
  ['', ''],
  ['📦 หมวด', ''],
  ['A — Data Persistence', `${tasks.filter(t => t[2].startsWith('A')).length} tasks`],
  ['B — Env Variables', `${tasks.filter(t => t[2].startsWith('B')).length} tasks`],
  ['C — Web UI', `${tasks.filter(t => t[2].startsWith('C')).length} tasks`],
  ['D — Worker/Executor', `${tasks.filter(t => t[2].startsWith('D')).length} tasks`],
  ['E — Security', `${tasks.filter(t => t[2].startsWith('E')).length} tasks`],
  ['F — Webhook', `${tasks.filter(t => t[2].startsWith('F')).length} tasks`],
  ['', ''],
  ['🗓 Sprint', ''],
  ['Sprint 1 — Vercel ทำงานได้', `${sprintTaskCount['Sprint 1']} tasks / ~2 วัน`],
  ['Sprint 2 — Security + UI', `${sprintTaskCount['Sprint 2']} tasks / ~2 วัน`],
  ['Sprint 3 — Logs + Monitor', `${sprintTaskCount['Sprint 3']} tasks / ~2 วัน`],
  ['Sprint 4 — Integrations', `${sprintTaskCount['Sprint 4']} tasks / ~2 วัน`],
]

summaryData.forEach((row, i) => {
  const wsRow = ws4.getRow(i + 2)
  wsRow.values = row
  wsRow.height = 22

  const labelCell = wsRow.getCell(1)
  const valueCell = wsRow.getCell(2)

  const isHeader = row[0].startsWith('📋') || row[0].startsWith('🔴') || row[0].startsWith('📦') || row[0].startsWith('🗓')
  if (isHeader) {
    labelCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6A1B9A' } }
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6A1B9A' } }
    ws4.mergeCells(`A${i + 2}:B${i + 2}`)
    wsRow.height = 28
  } else if (row[0] !== '') {
    labelCell.font = { size: 11 }
    valueCell.font = { bold: true, size: 11, color: { argb: 'FF1565C0' } }
    const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF3E5F5'
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' }
  }
})

// ─── Helper ──────────────────────────────────────────────────────────
function lighten(argb) {
  const r = Math.min(255, parseInt(argb.slice(2, 4), 16) + 15)
  const g = Math.min(255, parseInt(argb.slice(4, 6), 16) + 15)
  const b = Math.min(255, parseInt(argb.slice(6, 8), 16) + 15)
  return `FF${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

// ─── Save ────────────────────────────────────────────────────────────
const outPath = 'D:/workspace9/Han-AI-WBS.xlsx'
await wb.xlsx.writeFile(outPath)
console.log('✅ Created:', outPath)

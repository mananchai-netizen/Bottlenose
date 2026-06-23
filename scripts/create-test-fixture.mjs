/**
 * สร้าง test fixture: apps/ui/fixtures/test-requirement.xlsx
 * รัน: node scripts/create-test-fixture.mjs
 *
 * xlsx นี้จำลองไฟล์ requirement ที่ user อัพโหลดไปยัง Google Drive
 * เมื่อ Google Drive แปลงเป็น Google Sheet ระบบจะอ่านด้วย Sheets API
 * และส่งเนื้อหาให้ brain extract เป็น Notion tasks
 */

import XLSX from 'xlsx'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── Sheet 1: Requirements ──────────────────────────────────────────────────────
// Format: Title | Type | Priority | Context | Notes
// - Type: dev / doc / sheet / slide  (Han AI task types)
// - Priority: 1 (สูงสุด) → 4 (ต่ำสุด)
// - Context: brief ≤100 chars — ส่งไปยัง Notion context field

const requirements = [
  // Header
  ['Title', 'Type', 'Priority', 'Context', 'Notes'],
  // Dev tasks
  ['สร้าง RESTful API สำหรับ product CRUD operations',   'dev',   1, 'รองรับ pagination, filtering ตาม category และ brand', 'Express TypeScript, JWT auth'],
  ['เพิ่ม barcode scanner integration',                  'dev',   2, 'รองรับ QR Code และ Code128 format, auto-fill form',   'Mobile-first, html5-qrcode library'],
  ['ระบบ stock alert แจ้งเตือน LINE Notify',            'dev',   2, 'แจ้งเตือนเมื่อ stock ต่ำกว่า minimum threshold',      'Per-SKU threshold, daily summary'],
  ['สร้าง dashboard real-time stock summary',            'dev',   2, 'แสดง low-stock warnings และ movement chart',          'Chart.js, refresh ทุก 30 วินาที'],
  // Doc tasks
  ['เขียน API documentation ครบทุก endpoint',           'doc',   2, 'พร้อม request/response examples และ error codes',     'OpenAPI 3.0 spec, Swagger UI'],
  ['จัดทำ user manual สำหรับ warehouse staff',          'doc',   3, 'ภาษาไทย วิธีใช้ barcode scanner การรับ-จ่ายสินค้า', 'ภาพประกอบทุกขั้นตอน ≥20 หน้า'],
  // Sheet tasks
  ['สร้าง monthly inventory report template',           'sheet', 3, 'formula คำนวณ turnover rate และ dead stock',          'Google Sheets, pivot table included'],
  ['จัดทำ daily stock movement log template',           'sheet', 3, 'บันทึก in/out transactions พร้อม running balance',    'ARRAYFORMULA auto-sum'],
  // Slide tasks
  ['เตรียม slide สำหรับ project kickoff meeting',       'slide', 4, 'timeline change management สำหรับทีม warehouse',     '10 slides ภาษาไทย'],
  ['สร้าง demo presentation สำหรับ management review',  'slide', 4, 'system overview และ ROI projection',                  '15 slides ภาษาอังกฤษ'],
]

const wsReq = XLSX.utils.aoa_to_sheet(requirements)
wsReq['!cols'] = [
  { wch: 52 }, // Title
  { wch: 8  }, // Type
  { wch: 10 }, // Priority
  { wch: 48 }, // Context
  { wch: 35 }, // Notes
]

// Bold header (style เฉพาะ xlsx viewer — ไม่มีผลต่อ Google Sheets API read)
if (!wsReq['!rows']) wsReq['!rows'] = []
wsReq['!rows'][0] = { hpt: 20, hpx: 20 }

// ── Sheet 2: Project Info ──────────────────────────────────────────────────────
const projectInfo = [
  ['Field',         'Value'],
  ['Project',       'Inventory Management System'],
  ['Owner',         'Mananchain'],
  ['Version',       '1.0'],
  ['Date',          '2026-06-23'],
  ['Status',        'Approved'],
  ['Han AI Folder', 'google_drive_folder_id ใน HAN_PROJECTS_JSON'],
  ['Task count',    String(requirements.length - 1)],
  ['Brain',         'callBrain → qwen-runpod / claude / openrouter'],
  ['Notion DB',     'notion_db_id ใน HAN_PROJECTS_JSON'],
]

const wsInfo = XLSX.utils.aoa_to_sheet(projectInfo)
wsInfo['!cols'] = [{ wch: 20 }, { wch: 55 }]

// ── Sheet 3: Expected Tasks (สำหรับ unit test validation) ─────────────────────
// Brain ควร extract ออกมาเป็น JSON array นี้
const expectedJson = [
  { title: 'สร้าง RESTful API สำหรับ product CRUD operations',  type: 'dev',   status: 'New', priority: 1, context: 'รองรับ pagination, filtering ตาม category และ brand'  },
  { title: 'เพิ่ม barcode scanner integration',                 type: 'dev',   status: 'New', priority: 2, context: 'รองรับ QR Code และ Code128 format, auto-fill form'    },
  { title: 'ระบบ stock alert แจ้งเตือน LINE Notify',           type: 'dev',   status: 'New', priority: 2, context: 'แจ้งเตือนเมื่อ stock ต่ำกว่า minimum threshold'       },
  { title: 'สร้าง dashboard real-time stock summary',           type: 'dev',   status: 'New', priority: 2, context: 'แสดง low-stock warnings และ movement chart'           },
  { title: 'เขียน API documentation ครบทุก endpoint',          type: 'doc',   status: 'New', priority: 2, context: 'พร้อม request/response examples และ error codes'      },
  { title: 'จัดทำ user manual สำหรับ warehouse staff',         type: 'doc',   status: 'New', priority: 3, context: 'ภาษาไทย วิธีใช้ barcode scanner การรับ-จ่ายสินค้า'  },
  { title: 'สร้าง monthly inventory report template',          type: 'sheet', status: 'New', priority: 3, context: 'formula คำนวณ turnover rate และ dead stock'           },
  { title: 'จัดทำ daily stock movement log template',          type: 'sheet', status: 'New', priority: 3, context: 'บันทึก in/out transactions พร้อม running balance'     },
  { title: 'เตรียม slide สำหรับ project kickoff meeting',      type: 'slide', status: 'New', priority: 4, context: 'timeline change management สำหรับทีม warehouse'      },
  { title: 'สร้าง demo presentation สำหรับ management review', type: 'slide', status: 'New', priority: 4, context: 'system overview และ ROI projection'                  },
]

const expectedRows = [
  ['title', 'type', 'status', 'priority', 'context'],
  ...expectedJson.map(t => [t.title, t.type, t.status, t.priority, t.context]),
]

const wsExpected = XLSX.utils.aoa_to_sheet(expectedRows)
wsExpected['!cols'] = [{ wch: 52 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 50 }]

// ── Write workbook ─────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, wsReq,      'Requirements')
XLSX.utils.book_append_sheet(wb, wsInfo,     'Project Info')
XLSX.utils.book_append_sheet(wb, wsExpected, 'Expected Tasks')

const outDir = join(ROOT, 'apps', 'ui', 'fixtures')
mkdirSync(outDir, { recursive: true })

const outPath = join(outDir, 'test-requirement.xlsx')
XLSX.writeFile(wb, outPath)

console.log(`\n✅ Created: ${outPath}`)
console.log(`   Requirements sheet : ${requirements.length - 1} tasks`)
console.log(`   Expected Tasks sheet: ${expectedJson.length} tasks`)
console.log('\n📋 Expected JSON (copy to test mock):')
console.log(JSON.stringify(expectedJson, null, 2))

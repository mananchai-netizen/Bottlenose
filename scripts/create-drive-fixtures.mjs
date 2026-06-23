/**
 * สร้าง test fixtures สำหรับ Google Drive → Notion task extraction
 *
 * Output:
 *   apps/ui/fixtures/test-requirement.xlsx   — Excel workbook (3 sheets)
 *   apps/ui/fixtures/test-requirement.csv    — CSV เดียวกัน (upload → Google Sheets)
 *   apps/ui/fixtures/test-ecommerce.xlsx     — ชุดข้อมูลที่ 2 (e-commerce)
 *   apps/ui/fixtures/test-ecommerce.csv
 *
 * วิธีใช้งานจริง:
 *   1. รัน: node scripts/create-drive-fixtures.mjs
 *   2. อัพโหลดไฟล์ xlsx หรือ csv ไปยัง Google Drive folder
 *   3. Google Drive จะแปลง xlsx/csv → Google Sheet อัตโนมัติ
 *   4. Han AI จะอ่าน Sheet ผ่าน Sheets API แล้วส่งเนื้อหาให้ brain
 *   5. Brain extract tasks → สร้างใน Notion
 */

import XLSX from 'xlsx'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const OUT_DIR   = join(ROOT, 'apps', 'ui', 'fixtures')

mkdirSync(OUT_DIR, { recursive: true })

// ════════════════════════════════════════════════════════════════════════════════
// ชุดที่ 1: ระบบจัดการสินค้าคงคลัง (Inventory Management System)
// ════════════════════════════════════════════════════════════════════════════════

const INVENTORY_ROWS = [
  // Header — column names ชัดเจนช่วยให้ brain เข้าใจ structure
  ['Title', 'Type', 'Priority', 'Context', 'Notes'],

  // ── dev tasks ────────────────────────────────────────────────────────────────
  ['สร้าง RESTful API สำหรับ product CRUD operations',
   'dev', 1,
   'รองรับ pagination, filtering ตาม category และ brand',
   'Express + TypeScript, JWT auth, rate limiting'],

  ['เพิ่ม barcode scanner integration รองรับ QR Code และ Code128',
   'dev', 2,
   'รองรับ QR Code และ Code128 format พร้อม auto-fill product form',
   'Mobile-first, html5-qrcode library, offline fallback'],

  ['ระบบ stock alert แจ้งเตือนอัตโนมัติผ่าน LINE Notify',
   'dev', 2,
   'แจ้งเตือนเมื่อ stock ต่ำกว่า minimum threshold ต่อ SKU',
   'Per-SKU threshold config, daily summary digest'],

  ['สร้าง real-time dashboard แสดง stock summary และ movement chart',
   'dev', 2,
   'แสดง low-stock warnings และ weekly movement chart',
   'Chart.js, polling 30s, dark mode support'],

  ['Implement role-based access control (RBAC)',
   'dev', 3,
   'roles: admin, warehouse staff, viewer — จำกัด permission ต่างกัน',
   'JWT claims, middleware guard, audit log'],

  // ── doc tasks ────────────────────────────────────────────────────────────────
  ['เขียน API documentation ครบทุก endpoint พร้อม examples',
   'doc', 2,
   'พร้อม request/response examples และ error codes ทุก endpoint',
   'OpenAPI 3.0 spec, Swagger UI, Postman collection'],

  ['จัดทำ user manual สำหรับ warehouse staff ภาษาไทย',
   'doc', 3,
   'ภาษาไทย วิธีใช้ barcode scanner การรับ-จ่ายสินค้า stock count',
   'ภาพประกอบทุกขั้นตอน ≥20 หน้า PDF'],

  // ── sheet tasks ──────────────────────────────────────────────────────────────
  ['สร้าง monthly inventory report template พร้อม formula',
   'sheet', 3,
   'formula คำนวณ turnover rate, dead stock, reorder point',
   'Google Sheets, pivot table, conditional formatting'],

  ['จัดทำ daily stock movement log template',
   'sheet', 3,
   'บันทึก in/out transactions พร้อม running balance และ variance',
   'ARRAYFORMULA auto-sum, dropdown validation'],

  ['สร้าง supplier price comparison template',
   'sheet', 4,
   'เปรียบเทียบราคาต่อหน่วยจากหลาย supplier พร้อม recommended order qty',
   'VLOOKUP/XLOOKUP, sparklines'],

  // ── slide tasks ──────────────────────────────────────────────────────────────
  ['เตรียม slide สำหรับ project kickoff meeting ทีม warehouse',
   'slide', 4,
   'timeline, change management plan สำหรับทีม warehouse 20 คน',
   '10 slides ภาษาไทย, template Hanai Blue'],

  ['สร้าง demo presentation สำหรับ management review',
   'slide', 4,
   'system overview, ROI projection, go-live timeline',
   '15 slides ภาษาอังกฤษ, executive summary first'],
]

// ════════════════════════════════════════════════════════════════════════════════
// ชุดที่ 2: E-Commerce Platform Redesign
// ════════════════════════════════════════════════════════════════════════════════

const ECOMMERCE_ROWS = [
  ['Title', 'Type', 'Priority', 'Context', 'Notes'],

  // ── dev ──────────────────────────────────────────────────────────────────────
  ['Migrate product catalog to microservice architecture',
   'dev', 1,
   'แยก product service ออกจาก monolith รองรับ 10M SKU',
   'Node.js + gRPC, PostgreSQL, Redis cache L2'],

  ['Implement Elasticsearch product search with Thai language support',
   'dev', 1,
   'full-text search, faceted filter, typo-tolerance, Thai word segmentation',
   'ES 8.x, icu_analysis plugin, synonym dictionary'],

  ['สร้าง recommendation engine based on browsing history',
   'dev', 2,
   'collaborative filtering + content-based, real-time personalization',
   'Python FastAPI, Redis Streams, model retrain daily'],

  ['Redesign checkout flow ลด abandoned cart rate',
   'dev', 2,
   'single-page checkout, address autocomplete, saved payment methods',
   'Next.js App Router, Stripe, PromptPay QR'],

  ['Implement A/B testing framework for UI experiments',
   'dev', 3,
   'server-side split, sticky session, metrics collection',
   'Edge middleware, Vercel Analytics, statistical significance'],

  // ── doc ──────────────────────────────────────────────────────────────────────
  ['เขียน architecture decision records (ADR) สำหรับ microservice migration',
   'doc', 2,
   'บันทึกการตัดสินใจ tradeoffs ของแต่ละ service split decision',
   'ADR format, stored in /docs/adr, linked to PRs'],

  ['สร้าง runbook สำหรับ on-call engineer',
   'doc', 3,
   'incident response playbook ครอบคลุม top-10 alert scenarios',
   'Markdown, PagerDuty links, escalation matrix'],

  // ── sheet ────────────────────────────────────────────────────────────────────
  ['จัดทำ KPI dashboard template รายสัปดาห์',
   'sheet', 2,
   'GMV, conversion rate, CAC, LTV, NPS — week-over-week comparison',
   'Google Sheets, data from BigQuery via Connected Sheets'],

  ['สร้าง capacity planning spreadsheet สำหรับ Peak season',
   'sheet', 3,
   'คำนวณ server capacity, cost projection สำหรับ 11.11 และ 12.12',
   'Monte Carlo simulation, P50/P95/P99 scenarios'],

  // ── slide ────────────────────────────────────────────────────────────────────
  ['เตรียม quarterly business review presentation Q3 2026',
   'slide', 3,
   'revenue performance, product highlights, roadmap H2 2026',
   '20 slides, board-level, ภาษาอังกฤษ'],

  ['สร้าง technical deep-dive deck สำหรับ engineering all-hands',
   'slide', 4,
   'microservice migration progress, lessons learned, next quarter plan',
   '30 slides, technical audience, ภาษาไทย + ภาษาอังกฤษ'],
]

// ════════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════════

function rowsToTsv(rows) {
  return rows.map(r => r.map(cell => String(cell)).join('\t')).join('\n')
}

function rowsToCsv(rows) {
  return rows.map(r =>
    r.map(cell => {
      const s = String(cell)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }).join(',')
  ).join('\n')
}

function buildProjectInfoSheet(name, taskCount) {
  return [
    ['Field',         'Value'],
    ['Project',       name],
    ['Owner',         'Mananchain'],
    ['Version',       '1.0'],
    ['Date',          '2026-06-23'],
    ['Status',        'Approved — Ready for Han AI'],
    ['Task count',    String(taskCount)],
    ['Brain target',  'callBrain → extract JSON array of tasks'],
    ['Notion status', 'New (all tasks start as New)'],
    ['Upload to',     'Google Drive folder ใน HAN_PROJECTS_JSON'],
  ]
}

function buildExpectedSheet(rows) {
  const header = ['title', 'type', 'status', 'priority', 'context']
  const data   = rows.slice(1).map(r => [r[0], r[1], 'New', r[2], r[3]])
  return [header, ...data]
}

function buildXlsx(filename, projectName, rows) {
  // Sheet 1: Requirements (อ่านได้ทันที)
  const wsReq = XLSX.utils.aoa_to_sheet(rows)
  wsReq['!cols'] = [
    { wch: 55 }, // Title
    { wch: 8  }, // Type
    { wch: 10 }, // Priority
    { wch: 50 }, // Context
    { wch: 38 }, // Notes
  ]

  // Sheet 2: Project Info
  const wsInfo = XLSX.utils.aoa_to_sheet(buildProjectInfoSheet(projectName, rows.length - 1))
  wsInfo['!cols'] = [{ wch: 16 }, { wch: 60 }]

  // Sheet 3: Expected Tasks JSON (brain ควร return ออกมา)
  const wsExpected = XLSX.utils.aoa_to_sheet(buildExpectedSheet(rows))
  wsExpected['!cols'] = [{ wch: 55 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 50 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsReq,      'Requirements')
  XLSX.utils.book_append_sheet(wb, wsInfo,     'Project Info')
  XLSX.utils.book_append_sheet(wb, wsExpected, 'Expected Tasks')

  const outPath = join(OUT_DIR, filename)
  XLSX.writeFile(wb, outPath)
  return outPath
}

function buildCsv(filename, rows) {
  const outPath = join(OUT_DIR, filename)
  writeFileSync(outPath, '﻿' + rowsToCsv(rows), 'utf8') // BOM สำหรับ Excel Thai
  return outPath
}

// ════════════════════════════════════════════════════════════════════════════════
// Generate files
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n🔨 Generating Google Drive test fixtures...\n')

const files = [
  buildXlsx('test-requirement.xlsx',    'Inventory Management System', INVENTORY_ROWS),
  buildCsv ('test-requirement.csv',                                     INVENTORY_ROWS),
  buildXlsx('test-ecommerce.xlsx',      'E-Commerce Platform Redesign', ECOMMERCE_ROWS),
  buildCsv ('test-ecommerce.csv',                                        ECOMMERCE_ROWS),
]

files.forEach(f => console.log(`✅ ${f.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`))

console.log(`
📊 Summary:
   test-requirement : ${INVENTORY_ROWS.length  - 1} tasks (Inventory Management)
   test-ecommerce   : ${ECOMMERCE_ROWS.length - 1} tasks (E-Commerce Redesign)

📁 Upload ไปยัง Google Drive folder แล้ว Han AI จะอ่านเมื่อ webhook trigger

💡 Google Drive auto-converts xlsx/csv → Google Sheet
   Brain รับ TSV content จาก Sheets API แล้ว extract เป็น Notion tasks
`)

// Print TSV preview ของ dataset แรก (สำหรับ debug/test mock)
console.log('📋 TSV preview (test-requirement — ใช้ใน unit test mock):')
console.log('─'.repeat(60))
console.log(rowsToTsv(INVENTORY_ROWS.slice(0, 4)) + '\n...')

/**
 * Unit tests: runPlan() — Google Drive Sheet loader
 *
 * ทดสอบ flow ทั้งหมดของการอ่าน requirement จาก Google Drive (Google Sheet)
 * และสร้าง Notion tasks ผ่าน brain
 *
 * Mock dependencies:
 *   - googleapis  → Drive metadata + Sheets values
 *   - callBrain   → brain response (ไม่ hit real API)
 *   - @notionhq/client → capture created pages
 *   - node:fs     → ไม่อ่านไฟล์จริง (ใช้ GOOGLE_OAUTH_TOKEN_JSON แทน)
 *
 * Fixture: scripts/create-test-fixture.mjs → apps/ui/fixtures/test-requirement.xlsx
 * (Sheet data ด้านล่างตรงกับ xlsx ที่ generate ได้)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── vi.hoisted: สร้าง mock functions ก่อน vi.mock() factory จะรัน ──────────────
const {
  mockPagesCreate,
  mockSheetsValuesGet,
  mockDriveFilesGet,
  mockCallBrain,
} = vi.hoisted(() => ({
  mockPagesCreate:    vi.fn(),
  mockSheetsValuesGet: vi.fn(),
  mockDriveFilesGet:  vi.fn(),
  mockCallBrain:      vi.fn(),
}))

// ── Mock data (ตรงกับ fixtures/test-requirement.xlsx sheet "Requirements") ─────

/** Google Sheets API values.get() response (TSV rows) */
const SHEET_VALUES = [
  ['Title', 'Type', 'Priority', 'Context', 'Notes'],
  ['สร้าง RESTful API สำหรับ product CRUD operations',  'dev',   '1', 'รองรับ pagination, filtering ตาม category และ brand', 'Express TypeScript, JWT auth'],
  ['เพิ่ม barcode scanner integration',                 'dev',   '2', 'รองรับ QR Code และ Code128 format, auto-fill form',   'Mobile-first, html5-qrcode library'],
  ['ระบบ stock alert แจ้งเตือน LINE Notify',           'dev',   '2', 'แจ้งเตือนเมื่อ stock ต่ำกว่า minimum threshold',      'Per-SKU threshold, daily summary'],
  ['สร้าง dashboard real-time stock summary',           'dev',   '2', 'แสดง low-stock warnings และ movement chart',          'Chart.js, refresh ทุก 30 วินาที'],
  ['เขียน API documentation ครบทุก endpoint',          'doc',   '2', 'พร้อม request/response examples และ error codes',     'OpenAPI 3.0 spec, Swagger UI'],
  ['จัดทำ user manual สำหรับ warehouse staff',         'doc',   '3', 'ภาษาไทย วิธีใช้ barcode scanner การรับ-จ่ายสินค้า', 'ภาพประกอบทุกขั้นตอน ≥20 หน้า'],
  ['สร้าง monthly inventory report template',          'sheet', '3', 'formula คำนวณ turnover rate และ dead stock',          'Google Sheets, pivot table included'],
  ['จัดทำ daily stock movement log template',          'sheet', '3', 'บันทึก in/out transactions พร้อม running balance',    'ARRAYFORMULA auto-sum'],
  ['เตรียม slide สำหรับ project kickoff meeting',      'slide', '4', 'timeline change management สำหรับทีม warehouse',     '10 slides ภาษาไทย'],
  ['สร้าง demo presentation สำหรับ management review', 'slide', '4', 'system overview และ ROI projection',                  '15 slides ภาษาอังกฤษ'],
]

/** Brain ควร extract tasks เหล่านี้จาก sheet content */
const EXPECTED_TASKS = [
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

// ── env vars ───────────────────────────────────────────────────────────────────
const ENV = {
  NOTION_TOKEN: 'ntn_test_mock_token',
  GOOGLE_OAUTH_CLIENT_JSON: JSON.stringify({
    installed: { client_id: 'test-client-id', client_secret: 'test-client-secret' },
  }),
  // JSON inline token — ทำให้ createDriveAuth ไม่ต้องอ่านไฟล์จาก disk
  GOOGLE_OAUTH_TOKEN_JSON: JSON.stringify({
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'Bearer',
    expiry_date: 9999999999000,
  }),
  // ใช้ google_drive_file_id (single file) เพื่อหลีกเลี่ยง moveFilesToBackup flow
  HAN_PROJECTS_JSON: JSON.stringify([
    {
      notion_db_id: 'mock-notion-db-id-abc123',
      google_drive_file_id: 'mock-gdrive-file-id-xyz789',
    },
  ]),
}

// ── Mock googleapis ────────────────────────────────────────────────────────────
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        // ใช้ function keyword เพราะ run-plan.ts เรียกด้วย `new google.auth.OAuth2(...)`
        OAuth2: vi.fn().mockImplementation(function () {
          return { setCredentials: vi.fn() }
        }),
      },
      drive: vi.fn().mockImplementation(() => ({
        files: {
          list:   vi.fn(),
          get:    mockDriveFilesGet,
          update: vi.fn().mockResolvedValue({ data: {} }),
          create: vi.fn().mockResolvedValue({ data: { id: 'backup-folder-id' } }),
        },
      })),
      sheets: vi.fn().mockImplementation(() => ({
        spreadsheets: {
          values: { get: mockSheetsValuesGet },
        },
      })),
      docs:   vi.fn().mockImplementation(() => ({})),
      slides: vi.fn().mockImplementation(() => ({})),
    },
    Auth: {},
  }
})

// ── Mock callBrain ─────────────────────────────────────────────────────────────
vi.mock('../call-brain', () => ({ callBrain: mockCallBrain }))

// ── Mock mammoth ───────────────────────────────────────────────────────────────
vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: 'mock docx content' }) },
}))

// ── Mock NotionClient ──────────────────────────────────────────────────────────
vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(function () {
    return { pages: { create: mockPagesCreate } }
  }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

/** content ที่ run-plan.ts จะส่งเข้า brain (TSV จาก SHEET_VALUES) */
function sheetTsv(rows: string[][]): string {
  return rows.map(r => r.join('\t')).join('\n')
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runPlan — Google Drive Sheet loader', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = Object.fromEntries(Object.keys(ENV).map(k => [k, process.env[k]]))
    Object.entries(ENV).forEach(([k, v]) => { process.env[k] = v })

    // Default mocks
    mockDriveFilesGet.mockResolvedValue({
      data: {
        id:       'mock-gdrive-file-id-xyz789',
        name:     'test-requirement',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
    })
    mockSheetsValuesGet.mockResolvedValue({ data: { values: SHEET_VALUES } })
    mockCallBrain.mockResolvedValue(JSON.stringify(EXPECTED_TASKS))
    mockPagesCreate.mockResolvedValue({ id: 'notion-page-mock-001' })
  })

  afterEach(() => {
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    })
    vi.clearAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────────

  it('should call Drive files.get with correct file ID', async () => {
    const { runPlan } = await import('../run-plan')
    await runPlan()

    expect(mockDriveFilesGet).toHaveBeenCalledWith({
      fileId: 'mock-gdrive-file-id-xyz789',
      fields: 'id, name, mimeType',
    })
  })

  it('should call Sheets values.get with correct spreadsheet ID and range', async () => {
    const { runPlan } = await import('../run-plan')
    await runPlan()

    expect(mockSheetsValuesGet).toHaveBeenCalledWith({
      spreadsheetId: 'mock-gdrive-file-id-xyz789',
      range: 'A1:Z200',
    })
  })

  it('should send TSV sheet content to brain', async () => {
    const { runPlan } = await import('../run-plan')
    await runPlan()

    expect(mockCallBrain).toHaveBeenCalledTimes(1)

    const [systemPrompt, userPrompt] = mockCallBrain.mock.calls[0] as [string, string]
    expect(systemPrompt).toContain('Han AI planning agent')

    // userPrompt ต้องมี TSV content จาก sheet
    const expectedTsv = sheetTsv(SHEET_VALUES)
    expect(userPrompt).toContain(expectedTsv)
    expect(userPrompt).toContain('test-requirement') // ชื่อไฟล์
  })

  it('should create correct number of Notion pages', async () => {
    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    expect(mockPagesCreate).toHaveBeenCalledTimes(EXPECTED_TASKS.length)
    expect(result.total_created).toBe(EXPECTED_TASKS.length)
  })

  it('should create Notion pages with correct properties', async () => {
    const { runPlan } = await import('../run-plan')
    await runPlan()

    const calls = mockPagesCreate.mock.calls as Array<[{ parent: { database_id: string }, properties: Record<string, unknown> }]>

    // ตรวจ parent database_id
    calls.forEach(([arg]) => {
      expect(arg.parent.database_id).toBe('mock-notion-db-id-abc123')
    })

    // ตรวจ task แรก (P1 dev)
    const firstCall = calls[0]![0]
    const props = firstCall.properties as Record<string, {
      title?: Array<{ text: { content: string } }>
      select?: { name: string }
      number?: number
      rich_text?: Array<{ text: { content: string } }>
    }>

    expect(props['type']?.select?.name).toBe('dev')
    expect(props['status']?.select?.name).toBe('New')
    expect(props['priority']?.number).toBe(1)
    expect(props['title']?.title?.[0]?.text?.content).toContain('RESTful API')
  })

  it('should create tasks with all 4 types (dev/doc/sheet/slide)', async () => {
    const { runPlan } = await import('../run-plan')
    await runPlan()

    const calls = mockPagesCreate.mock.calls as Array<[{ properties: Record<string, { select?: { name: string } }> }]>
    const types = calls.map(([arg]) => arg.properties['type']?.select?.name)

    expect(types).toContain('dev')
    expect(types).toContain('doc')
    expect(types).toContain('sheet')
    expect(types).toContain('slide')
  })

  it('should return ok status and correct total_created', async () => {
    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    expect(result.status).toBe('ok')
    expect(result.total_created).toBe(EXPECTED_TASKS.length)
    expect(result.summary).toHaveLength(1)
    expect(result.summary[0]!.project).toBe('mock-notion-db-id-abc123')
  })

  it('should return no_projects_with_drive when no drive config', async () => {
    process.env['HAN_PROJECTS_JSON'] = JSON.stringify([
      { notion_db_id: 'db-no-drive' }, // ไม่มี google_drive_file_id หรือ folder_id
    ])

    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    expect(result.status).toBe('no_projects_with_drive')
    expect(result.total_created).toBe(0)
    expect(mockCallBrain).not.toHaveBeenCalled()
    expect(mockPagesCreate).not.toHaveBeenCalled()
  })

  it('should skip file when brain returns empty array', async () => {
    mockCallBrain.mockResolvedValue('[]')

    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    expect(mockPagesCreate).not.toHaveBeenCalled()
    expect(result.total_created).toBe(0)
  })

  it('should handle brain returning invalid JSON gracefully', async () => {
    mockCallBrain.mockResolvedValue('invalid json {{{}')

    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    // ไม่ throw — error ถูก catch ภายใน loop และ log
    expect(result.status).toBe('ok')
    expect(result.total_created).toBe(0)
    expect(mockPagesCreate).not.toHaveBeenCalled()
  })

  it('should handle empty sheet (no data rows) gracefully', async () => {
    mockSheetsValuesGet.mockResolvedValue({ data: { values: [] } })

    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    // ไฟล์มีเนื้อหาว่าง → ถูก skip
    expect(result.total_created).toBe(0)
    expect(mockCallBrain).not.toHaveBeenCalled()
  })

  it('should handle Drive API error gracefully', async () => {
    mockDriveFilesGet.mockRejectedValue(new Error('Drive API 403: Forbidden'))

    const { runPlan } = await import('../run-plan')
    const result = await runPlan()

    expect(result.status).toBe('ok')
    expect(result.total_created).toBe(0)
  })

  it('should handle missing NOTION_TOKEN', async () => {
    delete process.env['NOTION_TOKEN']

    const { runPlan } = await import('../run-plan')
    await expect(runPlan()).rejects.toThrow('NOTION_TOKEN required')
  })
})

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const _dbUrl = process.env.DATABASE_URL ?? '';
const _isLocal = _dbUrl.includes('localhost') || _dbUrl.includes('127.0.0.1');
if (!_isLocal) {
  neonConfig.webSocketConstructor = ws;
}

let _pool: Pool | null = null;
let _schemaReady = false;

export function getDb(): Pool | null {
  if (_pool !== null) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = getDb();
  if (db === null) throw new Error('DATABASE_URL not set');
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const db = getDb();
  if (db === null) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS machine_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_configs (
      project_id TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS runpod_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_outputs (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      notion_page_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      brain_used TEXT,
      output TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS task_outputs_notion_page_id_idx
    ON task_outputs (notion_page_id)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_logs (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      notion_page_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      step TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS task_logs_task_id_idx
    ON task_logs (task_id)
  `);
  _schemaReady = true;
}

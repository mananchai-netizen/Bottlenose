/**
 * Seed Neon DB with initial config
 * Run: DATABASE_URL=<neon_url> node apps/ui/scripts/seed-neon.mjs
 * All values are read from environment variables.
 */
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var is not set');
  process.exit(1);
}

const MACHINE_CONFIG = {
  machine_id:           process.env.HAN_MACHINE_ID   ?? 'vercel-worker',
  machine_name:         'Vercel Worker',
  accept_types:         ['dev', 'doc', 'sheet', 'slide'],
  brain:                { default: 'qwen3-max' },
  notion_token:         process.env.NOTION_TOKEN      ?? '',
  redis_url:            process.env.REDIS_URL         ?? '',
  github_token:         process.env.GITHUB_TOKEN      ?? '',
  poll_interval:        30,
  max_concurrent_tasks: 1,
};

const RUNPOD_CONFIG = {
  qwen_endpoint_id: process.env.QWEN_RUNPOD_URL?.split('/v2/')[1]?.split('/')[0] ?? '',
  qwen_token:       process.env.QWEN_RUNPOD_TOKEN ?? '',
};

const DEFAULT_USERS = [
  { username: 'root',  password: 'root1234', role: 'root'  },
  { username: 'admin', password: 'admin123', role: 'admin' },
];

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // 1. Ensure tables
    await client.query(`CREATE TABLE IF NOT EXISTS machine_config (id INTEGER PRIMARY KEY DEFAULT 1, config JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS project_configs (project_id TEXT PRIMARY KEY, config JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS runpod_config (id INTEGER PRIMARY KEY DEFAULT 1, config JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TIMESTAMPTZ DEFAULT NOW())`);

    // 2. Upsert machine_config
    await client.query(
      `INSERT INTO machine_config (id, config, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      [JSON.stringify(MACHINE_CONFIG)],
    );
    console.log('machine_config upserted');

    // 3. Upsert runpod_config
    await client.query(
      `INSERT INTO runpod_config (id, config, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      [JSON.stringify(RUNPOD_CONFIG)],
    );
    console.log('runpod_config upserted');

    // 4. Default users (skip if exists)
    for (const user of DEFAULT_USERS) {
      await client.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
        [user.username, user.password, user.role],
      );
      console.log(`users: ${user.username} (skip if exists)`);
    }

    console.log('\nSeed complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

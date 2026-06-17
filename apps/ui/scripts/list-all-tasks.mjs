import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { Client } = await import('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const res = await notion.databases.query({ database_id: '35d8d276aed480c0bc49f45dff946de1' });
console.log(`Total: ${res.results.length} tasks\n`);
for (const page of res.results) {
  const p = page.properties;
  const title = p.title?.title?.[0]?.plain_text ?? '(no title)';
  const type = p.type?.select?.name ?? '-';
  const status = p.status?.select?.name ?? '-';
  const context = p.context?.rich_text?.[0]?.plain_text ?? '';
  console.log(`${title} | ${type} | ${status}`);
  if (context) console.log(`  context: ${context}`);
}

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const clientCfg = JSON.parse(process.env.GOOGLE_OAUTH_CLIENT_JSON).installed;
const oauth2 = new google.auth.OAuth2(clientCfg.client_id, clientCfg.client_secret);
oauth2.setCredentials(JSON.parse(readFileSync(process.env.GOOGLE_OAUTH_TOKEN_PATH, 'utf8')));
const drive = google.drive({ version: 'v3', auth: oauth2 });
const filesRes = await drive.files.list({ q: `'1lsOr5BKrYHdj_XN3iFAY5ER8fDYuZpy4' in parents and trashed = false`, fields: 'files(id,name,mimeType)' });
const docs = google.docs({ version: 'v1', auth: oauth2 });
const doc = await docs.documents.get({ documentId: filesRes.data.files[0].id });
const driveContent = doc.data.body?.content?.flatMap(e => e.paragraph?.elements?.map(pe => pe.textRun?.content ?? '') ?? []).join('') ?? '';

const systemPrompt = `You are Han AI planning agent. Extract tasks from Google Drive content.
Return ONLY a compact JSON array (no whitespace, no markdown, no explanation).
Each task: {"title":"...","type":"dev|doc|sheet|slide","status":"New","priority":1,"context":"..."}
Rules: use content only, no duplicates, keep context under 100 chars, max 8 tasks.`;

const res = await fetch(process.env.QWEN_RUNPOD_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QWEN_RUNPOD_TOKEN}` },
  body: JSON.stringify({
    input: {
      model: process.env.QWEN_MODEL_NAME,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${driveContent}\n\nReturn only compact JSON array.` },
      ],
      max_tokens: 1024,
      max_new_tokens: 1024,
      temperature: 0.1,
    },
  }),
});

const data = await res.json();
const raw = data.output[0]?.choices?.[0]?.tokens?.[0] ?? data.output[0]?.choices?.[0]?.message?.content ?? '';
console.log(`Output length: ${raw.length} chars`);
console.log('\nRaw output:\n---');
console.log(raw);
console.log('---');

try {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = trimmed.startsWith('[') ? 0 : trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  const arr = JSON.parse(trimmed.slice(start, end + 1));
  console.log(`\n✅ Parsed ${arr.length} tasks`);
  arr.forEach(t => console.log(` - [${t.type}] P${t.priority} ${t.title}`));
} catch (e) {
  console.error('\n❌ JSON parse failed:', e.message);
}

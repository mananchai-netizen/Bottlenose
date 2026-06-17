import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON;
const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH;
const credentials = JSON.parse(clientJson);
const clientConfig = credentials.installed ?? credentials.web;
const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret);
oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));

const docs = google.docs({ version: 'v1', auth: oauth2 });
const fileId = '1NnH9VUgq7FtzR49GsBxYLB1oxJ2Vxcmo2FLNG65tZEM';

const res = await docs.documents.get({ documentId: fileId });
const parts = [];
for (const el of res.data.body?.content ?? []) {
  for (const pe of el.paragraph?.elements ?? []) {
    const text = pe.textRun?.content;
    if (text) parts.push(text);
  }
}
const content = parts.join('');
console.log('=== requirement doc content ===\n');
console.log(content || '(empty document)');

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON;
const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH;
if (!clientJson || !tokenPath || !existsSync(tokenPath)) {
  console.error('❌ Missing GOOGLE_OAUTH_CLIENT_JSON or GOOGLE_OAUTH_TOKEN_PATH');
  process.exit(1);
}

const credentials = JSON.parse(clientJson);
const clientConfig = credentials.installed ?? credentials.web;
const oauth2 = new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret);
oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));

const drive = google.drive({ version: 'v3', auth: oauth2 });

async function listFolders(parentId, indent = '') {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: 50,
  });
  for (const folder of res.data.files ?? []) {
    console.log(`${indent}📁 ${folder.name}  [${folder.id}]`);
    await listFolders(folder.id, indent + '   ');
  }
}

console.log('📂 My Drive (root)\n');
await listFolders('root');

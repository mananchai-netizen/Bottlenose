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

const drive = google.drive({ version: 'v3', auth: oauth2 });
const folderId = '1lsOr5BKrYHdj_XN3iFAY5ER8fDYuZpy4'; // bottlenose

console.log('📁 bottlenose folder contents:\n');
const res = await drive.files.list({
  q: `'${folderId}' in parents and trashed = false`,
  fields: 'files(id, name, mimeType)',
  orderBy: 'name',
});

if (!res.data.files?.length) {
  console.log('(empty — no files in this folder)');
} else {
  for (const f of res.data.files) {
    const icon = f.mimeType.includes('document') ? '📄' :
                 f.mimeType.includes('spreadsheet') ? '📊' :
                 f.mimeType.includes('presentation') ? '📑' :
                 f.mimeType.includes('folder') ? '📁' : '📎';
    console.log(`${icon} ${f.name}`);
    console.log(`   id  : ${f.id}`);
    console.log(`   type: ${f.mimeType}\n`);
  }
}

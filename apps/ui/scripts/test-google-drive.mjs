import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

// Check GOOGLE_OAUTH_CLIENT_JSON
const clientJson = process.env.GOOGLE_OAUTH_CLIENT_JSON;
if (!clientJson) {
  console.error('❌ GOOGLE_OAUTH_CLIENT_JSON not set in .env.local');
  process.exit(1);
}

// Check GOOGLE_OAUTH_TOKEN_PATH
const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH;
if (!tokenPath || !existsSync(tokenPath)) {
  console.error(`❌ GOOGLE_OAUTH_TOKEN_PATH not set or file not found: ${tokenPath ?? '(empty)'}`);
  process.exit(1);
}

console.log('✅ GOOGLE_OAUTH_CLIENT_JSON loaded from .env.local');
console.log('✅ GOOGLE_OAUTH_TOKEN_PATH :', tokenPath);

// Build OAuth2 client from env vars
const credentials = JSON.parse(clientJson);
const clientConfig = credentials.installed ?? credentials.web;
const oauth2 = new google.auth.OAuth2(
  clientConfig.client_id,
  clientConfig.client_secret,
  clientConfig.redirect_uris?.[0] ?? 'http://127.0.0.1:53682/oauth2callback',
);
oauth2.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));

try {
  const drive = google.drive({ version: 'v3', auth: oauth2 });
  const res = await drive.about.get({ fields: 'user,storageQuota' });

  const user = res.data.user;
  const quota = res.data.storageQuota;
  const usedMb = quota?.usage ? (Number(quota.usage) / 1024 / 1024).toFixed(1) : '?';
  const limitMb = quota?.limit ? (Number(quota.limit) / 1024 / 1024 / 1024).toFixed(1) + ' GB' : 'unlimited';

  console.log('\n✅ Google Drive connected!');
  console.log(`   User    : ${user?.displayName} <${user?.emailAddress}>`);
  console.log(`   Storage : ${usedMb} MB used / ${limitMb}`);
} catch (err) {
  console.error('❌ Google Drive API error:', err.message);
  process.exit(1);
}

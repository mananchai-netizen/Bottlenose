import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { getMachineConfig, saveMachineConfig } from '../../config.js';

const CONFIG_DIR = path.join(os.homedir(), '.han');
const REDIRECT_PORT = 53682;
const REDIRECT_PATH = '/oauth2callback';
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
];

interface OAuthClientFile {
  installed?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
}

function findEnvLocal(): string | null {
  const candidates = [
    path.join(process.cwd(), 'apps', 'ui', '.env.local'),
    path.join(process.cwd(), '.env.local'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadEnvLocal(): void {
  const envPath = findEnvLocal();
  if (envPath !== null) {
    dotenv.config({ path: envPath });
  }
}

function loadOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const raw = process.env.GOOGLE_OAUTH_CLIENT_JSON;
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error('GOOGLE_OAUTH_CLIENT_JSON is not set in .env.local');
  }

  const credentials = JSON.parse(raw) as OAuthClientFile;
  const clientConfig = credentials.installed ?? credentials.web;
  if (clientConfig?.client_id === undefined || clientConfig.client_secret === undefined) {
    throw new Error('Invalid GOOGLE_OAUTH_CLIENT_JSON: missing client_id or client_secret');
  }

  return new google.auth.OAuth2(clientConfig.client_id, clientConfig.client_secret, REDIRECT_URI);
}

function getTokenPath(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_TOKEN_PATH;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(CONFIG_DIR, 'google-oauth-token.json');
}

async function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', REDIRECT_URI);
        if (requestUrl.pathname !== REDIRECT_PATH) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        if (error !== null) {
          res.writeHead(400);
          res.end('Authorization failed. You can close this tab.');
          reject(new Error(`Google OAuth failed: ${error}`));
          server.close();
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (code === null || code.length === 0) {
          res.writeHead(400);
          res.end('Missing authorization code. You can close this tab.');
          reject(new Error('Google OAuth callback did not include a code.'));
          server.close();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Google authorization complete. You can close this tab and return to Han.');
        resolve(code);
        server.close();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        server.close();
      }
    });

    server.on('error', (err) => reject(err));
    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

export function googleAuthCommand(): Command {
  return new Command('google-auth')
    .description('Authorize Google Drive/Docs/Sheets/Slides with a user OAuth account')
    .action(async () => {
      try {
        loadEnvLocal();

        const oauth2Client = loadOAuthClient();
        const tokenPath = getTokenPath();

        const url = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
        });

        console.log(chalk.cyan('Open this URL in your browser and approve access:'));
        console.log(url);
        console.log(chalk.gray(`\nWaiting for callback on ${REDIRECT_URI} ...`));

        const code = await waitForAuthCode();
        const { tokens } = await oauth2Client.getToken(code);
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`);
        console.log(chalk.green(`Google OAuth token saved: ${tokenPath}`));

        const config = getMachineConfig();
        if (config !== null) {
          saveMachineConfig({ ...config, google_oauth_token_path: tokenPath });
          console.log(chalk.gray(`google_oauth_token_path saved to ~/.han/config.json`));
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}

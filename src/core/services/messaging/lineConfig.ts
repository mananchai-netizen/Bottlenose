import fs from 'fs';
import os from 'os';
import path from 'path';

interface LineConfig {
  line_channel_access_token?: string;
  line_channel_secret?: string;
}

const configPath = path.join(os.homedir(), '.han', 'config.json');

function readLineConfig(): LineConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Machine config not found: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as LineConfig;
}

function requireConfigValue(key: keyof LineConfig): string {
  const value = readLineConfig()[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${key} in ~/.han/config.json`);
  }
  return value;
}

export function getLineChannelAccessToken(): string {
  return requireConfigValue('line_channel_access_token');
}

export function getLineChannelSecret(): string {
  return requireConfigValue('line_channel_secret');
}

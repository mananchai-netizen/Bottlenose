import os from 'os';
import path from 'path';

export function getHanDataDir(): string {
  const override = process.env.HAN_UI_DATA_DIR ?? process.env.HAN_RUNTIME_CONFIG_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return path.resolve(expandHome(override));
  }

  if (process.env.VERCEL === '1') {
    return path.join(os.tmpdir(), 'han');
  }

  return path.join(os.homedir(), '.han');
}

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MachineConfig, ProjectConfig } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.han');
const MACHINE_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const PROJECTS_CONFIG_PATH = path.join(CONFIG_DIR, 'projects.json');
const RUNTIME_CONFIG_DIR = process.env.HAN_RUNTIME_CONFIG_DIR || path.join(os.tmpdir(), 'han');

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith(`~${path.sep}`) || filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function parseJsonEnv<T>(envName: string): T | null {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim().length === 0) return null;

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${envName}: ${msg}`);
  }
}

function writeJsonEnvToFile(envName: string, filePath: string): string | undefined {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim().length === 0) return undefined;

  const resolvedPath = path.resolve(expandHome(filePath));
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, raw);
  return resolvedPath;
}

function getReadableConfigPath(envName: string, fallback: string): string {
  const override = process.env[envName];
  return path.resolve(expandHome(override !== undefined && override.trim().length > 0 ? override : fallback));
}

function getWritableConfigPath(envName: string, fallback: string): string {
  const override = process.env[envName];
  return path.resolve(expandHome(override !== undefined && override.trim().length > 0 ? override : fallback));
}

export function getMachineConfigPath(): string {
  return getReadableConfigPath('HAN_CONFIG_PATH', MACHINE_CONFIG_PATH);
}

export function getProjectsConfigPath(): string {
  return getReadableConfigPath('HAN_PROJECTS_PATH', PROJECTS_CONFIG_PATH);
}

export function materializeGoogleCredentialsFromEnv(): {
  serviceAccountPath?: string;
  oauthClientPath?: string;
  oauthTokenPath?: string;
} {
  const result: {
    serviceAccountPath?: string;
    oauthClientPath?: string;
    oauthTokenPath?: string;
  } = {};

  const serviceAccountPath = writeJsonEnvToFile(
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    path.join(RUNTIME_CONFIG_DIR, 'service-account.json'),
  );
  if (serviceAccountPath !== undefined) result.serviceAccountPath = serviceAccountPath;

  const oauthClientPath = writeJsonEnvToFile(
    'GOOGLE_OAUTH_CLIENT_JSON',
    path.join(RUNTIME_CONFIG_DIR, 'google-oauth-client.json'),
  );
  if (oauthClientPath !== undefined) result.oauthClientPath = oauthClientPath;

  const oauthTokenPath = writeJsonEnvToFile(
    'GOOGLE_OAUTH_TOKEN_JSON',
    path.join(RUNTIME_CONFIG_DIR, 'google-oauth-token.json'),
  );
  if (oauthTokenPath !== undefined) result.oauthTokenPath = oauthTokenPath;

  return result;
}

export function getMachineConfig(): MachineConfig | null {
  const envConfig = parseJsonEnv<MachineConfig>('HAN_CONFIG_JSON');
  if (envConfig !== null) return envConfig;

  const configPath = getMachineConfigPath();
  if (!fs.existsSync(configPath)) return null;
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as MachineConfig;
}

export function saveMachineConfig(config: MachineConfig): void {
  const configPath = getWritableConfigPath('HAN_CONFIG_PATH', MACHINE_CONFIG_PATH);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getProjects(): ProjectConfig[] {
  const envProjects = parseJsonEnv<ProjectConfig[]>('HAN_PROJECTS_JSON');
  if (envProjects !== null) return envProjects;

  const projectsPath = getProjectsConfigPath();
  if (!fs.existsSync(projectsPath)) return [];
  const raw = fs.readFileSync(projectsPath, 'utf-8');
  return JSON.parse(raw) as ProjectConfig[];
}

export function saveProject(project: ProjectConfig): void {
  ensureConfigDir();
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.project_id === project.project_id);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.push(project);
  }
  const projectsPath = getWritableConfigPath('HAN_PROJECTS_PATH', PROJECTS_CONFIG_PATH);
  fs.mkdirSync(path.dirname(projectsPath), { recursive: true });
  fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2));
}

export function deleteProject(projectId: string): void {
  const projects = getProjects().filter((p) => p.project_id !== projectId);
  const projectsPath = getWritableConfigPath('HAN_PROJECTS_PATH', PROJECTS_CONFIG_PATH);
  fs.mkdirSync(path.dirname(projectsPath), { recursive: true });
  fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2));
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

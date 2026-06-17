import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@notionhq/client';

const configPath = path.join(os.homedir(), '.han', 'config.json');
const projectsPath = path.join(os.homedir(), '.han', 'projects.json');

const statusOptions = [
  { name: 'New', color: 'gray' },
  { name: 'Approve', color: 'yellow' },
  { name: 'In-Progress', color: 'blue' },
  { name: 'Done', color: 'green' },
  { name: 'Failed', color: 'red' },
];

const typeOptions = [
  { name: 'dev', color: 'blue' },
  { name: 'doc', color: 'green' },
  { name: 'sheet', color: 'yellow' },
  { name: 'slide', color: 'purple' },
];

const brainOptions = [
  { name: 'claude-cli', color: 'gray' },
  { name: 'claude-sonnet-4-6', color: 'blue' },
  { name: 'claude-opus-4-7', color: 'purple' },
  { name: 'gemini-2.5-pro', color: 'green' },
  { name: 'gemini-2.0-flash', color: 'yellow' },
  { name: 'llm-server', color: 'orange' },
];

const taskPropertySchemas = [
  ['type', { type: 'select', select: { options: typeOptions } }],
  ['status', { type: 'select', select: { options: statusOptions } }],
  ['priority', { type: 'number', number: { format: 'number' } }],
  ['assigned_to', { type: 'select', select: { options: [] } }],
  ['retry_count', { type: 'number', number: { format: 'number' } }],
  ['planned_by', { type: 'select', select: { options: [] } }],
  ['planned_at', { type: 'date', date: {} }],
  ['claimed_by', { type: 'select', select: { options: [] } }],
  ['claimed_at', { type: 'date', date: {} }],
  ['heartbeat_at', { type: 'date', date: {} }],
  ['output_url', { type: 'url', url: {} }],
  ['error_log', { type: 'rich_text', rich_text: {} }],
  ['brain_used', { type: 'select', select: { options: brainOptions } }],
  ['project_id', { type: 'select', select: { options: [] } }],
  ['context', { type: 'rich_text', rich_text: {} }],
];

const requiredSchema = Object.fromEntries(taskPropertySchemas);

const createDatabaseProperties = {
  title: { title: {} },
  ...Object.fromEntries(taskPropertySchemas),
};

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mergeSelectOptions(existing = [], desired = []) {
  const byName = new Map(existing.map((option) => [option.name, option]));
  for (const option of desired) {
    if (!byName.has(option.name)) {
      byName.set(option.name, option);
    }
  }
  return Array.from(byName.values()).map((option) => ({
    name: option.name,
    color: option.color ?? 'default',
  }));
}

function buildPropertyPatch(db) {
  const patch = {};
  const warnings = [];
  const props = db.properties;
  const titleProp = Object.values(props).find((prop) => prop.type === 'title');

  if (titleProp === undefined) {
    warnings.push('No title property found. Create or rename one to `title` in Notion.');
  } else if (titleProp.name !== 'title') {
    patch[titleProp.name] = { type: 'title', title: {}, name: 'title' };
  }

  for (const [name, schema] of taskPropertySchemas) {
    const existing = props[name];

    if (existing === undefined) {
      patch[name] = schema;
      continue;
    }

    if (existing.type !== schema.type) {
      warnings.push(
        `Property \`${name}\` has type \`${existing.type}\`, expected \`${schema.type}\`. Rename/fix it in Notion before running the worker.`,
      );
      continue;
    }

    if (schema.type === 'select') {
      const mergedOptions = mergeSelectOptions(existing.select?.options, schema.select.options);
      const existingNames = new Set((existing.select?.options ?? []).map((option) => option.name));
      const missing = schema.select.options.some((option) => !existingNames.has(option.name));
      if (missing) {
        patch[name] = {
          type: 'select',
          select: { options: mergedOptions },
        };
      }
    }
  }

  return { patch, warnings };
}

function getPageTitle(page) {
  const titleProp = Object.values(page.properties ?? {}).find((prop) => prop.type === 'title');
  return titleProp?.title?.map((item) => item.plain_text).join('') ?? '';
}

async function findParentPage(notion) {
  const response = await notion.search({
    filter: { property: 'object', value: 'page' },
    page_size: 20,
  });

  return response.results[0];
}

async function createTaskDatabase(notion, parentPageId) {
  return notion.databases.create({
    parent: {
      type: 'page_id',
      page_id: parentPageId,
    },
    title: [{ type: 'text', text: { content: 'Han Tasks' } }],
    properties: createDatabaseProperties,
  });
}

async function ensureDatabaseSchema(notion, databaseId, label) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const { patch, warnings } = buildPropertyPatch(db);
  const patchKeys = Object.keys(patch);

  if (patchKeys.length > 0) {
    await notion.databases.update({
      database_id: databaseId,
      title: [{ type: 'text', text: { content: 'Han Tasks' } }],
      properties: patch,
    });
  }

  console.log(label);
  console.log(`  database_id: ${databaseId}`);
  console.log(`  updated_properties: ${patchKeys.length === 0 ? '(none)' : patchKeys.join(', ')}`);
  for (const warning of warnings) {
    console.log(`  warning: ${warning}`);
  }
}

async function main() {
  const config = readJson(configPath, 'Machine config');
  const projects = readJson(projectsPath, 'Projects config');

  if (typeof config.notion_token !== 'string' || config.notion_token.length === 0) {
    throw new Error('Missing notion_token in machine config.');
  }

  const notion = new Client({ auth: config.notion_token });
  const targetProjects = projects.filter((project) => Boolean(project.notion_db_id));

  if (targetProjects.length === 0) {
    throw new Error('No projects with notion_db_id found.');
  }

  let projectsChanged = false;

  for (const project of targetProjects) {
    let db;
    try {
      db = await notion.databases.retrieve({ database_id: project.notion_db_id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Could not find database')) {
        throw error;
      }

      const parentPage = await findParentPage(notion);
      if (parentPage === undefined) {
        throw new Error('No shared Notion page found for creating the task database.');
      }

      db = await createTaskDatabase(notion, parentPage.id);
      project.notion_db_id = db.id;
      projectsChanged = true;
      console.log(`[${project.project_id}] created database under page: ${getPageTitle(parentPage)}`);
    }

    await ensureDatabaseSchema(notion, project.notion_db_id, `[${project.project_id}] ${project.project_name}`);
  }

  if (projectsChanged) {
    fs.writeFileSync(projectsPath, `${JSON.stringify(projects, null, 2)}\n`);
    console.log(`updated project config: ${projectsPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

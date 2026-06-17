import chalk from 'chalk';
import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';
import type { ExecutorResult } from './index.js';
import { resolveBrain } from '../brains/router.js';
import { GoogleDriveClient } from '../integrations/google-drive.js';
import { parseJsonObjectFromBrainOutput } from './json-output.js';

const DOC_SYSTEM_PROMPT = `You are Han AI — an autonomous document agent.
You have been given the content of Google Docs from a project folder.
Complete the task using the document content as context.
Return only valid JSON with this shape:
{
  "title": "Google Doc title",
  "body": "Document body as plain text"
}`;

interface DocBrainOutput {
  title: string;
  body: string;
}

function parseDocBrainOutput(text: string): DocBrainOutput {
  const parsed = parseJsonObjectFromBrainOutput(text, 'Doc brain output');

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Doc brain output must be a JSON object.');
  }

  const output = parsed as Partial<DocBrainOutput>;
  if (typeof output.title !== 'string' || output.title.trim().length === 0) {
    throw new Error('Doc brain output must include a non-empty string "title".');
  }
  if (typeof output.body !== 'string' || output.body.trim().length === 0) {
    throw new Error('Doc brain output must include a non-empty string "body".');
  }

  return {
    title: output.title.trim(),
    body: output.body.trim(),
  };
}

export async function docExecutor(
  task: HanTask,
  config: MachineConfig,
  project: ProjectConfig,
): Promise<ExecutorResult> {
  if (project.google_drive_folder_id === undefined) {
    throw new Error(`Project "${project.project_id}" has no google_drive_folder_id configured`);
  }

  const drive = new GoogleDriveClient({
    ...(config.google_key_path !== undefined && { keyPath: config.google_key_path }),
    ...(config.google_oauth_token_path !== undefined && { oauthTokenPath: config.google_oauth_token_path }),
    ...(config.google_oauth_client_path !== undefined && { oauthClientPath: config.google_oauth_client_path }),
  });

  console.log(chalk.gray(`   listing Drive folder ${project.google_drive_folder_id}...`));
  const files = await drive.listFiles(project.google_drive_folder_id);
  const docFiles = files.filter((f) => f.mimeType === 'application/vnd.google-apps.document');

  const contexts = await Promise.all(
    docFiles.map(async (file) => {
      console.log(chalk.gray(`   reading doc: ${file.name}...`));
      try {
        const content = await drive.getDocContent(file.id);
        return `=== ${file.name} ===\n${content}`;
      } catch (err) {
        console.log(chalk.yellow(`   warning: could not read doc "${file.name}": ${String(err)}`));
        return `=== ${file.name} ===\n[unavailable]`;
      }
    }),
  );

  const brain = resolveBrain(config, 'doc');

  const userPrompt = [
    `Task: ${task.title}`,
    task.context !== undefined ? `\nContext:\n${task.context}` : '',
    contexts.length > 0 ? `\n\nGoogle Drive Content:\n${contexts.join('\n\n')}` : '',
    `\nCreate the requested document based on the content above.`,
    `Return only JSON. Do not wrap it in Markdown.`,
  ].join('');

  console.log(chalk.gray(`   running brain: ${config.brain.doc ?? config.brain.default}...`));
  const result = await brain.run({ systemPrompt: DOC_SYSTEM_PROMPT, userPrompt });
  const output = parseDocBrainOutput(result.text);

  console.log(chalk.gray(`   ensuring Drive output folder docs...`));
  const outputFolder = await drive.ensureFolder(project.google_drive_folder_id, 'docs');

  console.log(chalk.gray(`   creating Google Doc: ${output.title}...`));
  const created = await drive.createDoc(outputFolder.id, output.title, output.body);
  if (created.webViewLink === undefined) {
    throw new Error(`Google Drive did not return a webViewLink for doc: ${created.id}`);
  }

  console.log(chalk.gray(`   sharing Google Doc publicly...`));
  await drive.sharePublicRead(created.id);

  console.log(chalk.green(`   doc task complete`));
  return { outputUrl: created.webViewLink, brainUsed: result.brainUsed };
}

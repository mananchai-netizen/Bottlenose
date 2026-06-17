import chalk from 'chalk';
import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';
import type { ExecutorResult } from './index.js';
import { resolveBrain } from '../brains/router.js';
import { GoogleDriveClient, type DriveSheetTab, type SheetCellValue } from '../integrations/google-drive.js';
import { parseJsonObjectFromBrainOutput } from './json-output.js';

const SHEET_SYSTEM_PROMPT = `You are Han AI — an autonomous data analyst agent.
You have been given the content of Google Sheets from a project folder as tab-separated values.
Complete the task using the spreadsheet data as context.
Return only valid JSON with this shape:
{
  "title": "Google Sheet title",
  "sheets": [
    {
      "name": "Sheet1",
      "rows": [
        ["Header A", "Header B"],
        ["Value A", "Value B"]
      ]
    }
  ]
}`;

interface SheetBrainOutput {
  title: string;
  sheets: DriveSheetTab[];
}

function isSheetCellValue(value: unknown): value is SheetCellValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function parseSheetBrainOutput(text: string): SheetBrainOutput {
  const parsed = parseJsonObjectFromBrainOutput(text, 'Sheet brain output');

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Sheet brain output must be a JSON object.');
  }

  const output = parsed as { title?: unknown; sheets?: unknown };
  if (typeof output.title !== 'string' || output.title.trim().length === 0) {
    throw new Error('Sheet brain output must include a non-empty string "title".');
  }
  if (!Array.isArray(output.sheets) || output.sheets.length === 0) {
    throw new Error('Sheet brain output must include a non-empty "sheets" array.');
  }

  const sheets = output.sheets.map((sheet, sheetIndex): DriveSheetTab => {
    if (typeof sheet !== 'object' || sheet === null) {
      throw new Error(`Sheet brain output sheets[${sheetIndex}] must be an object.`);
    }

    const candidate = sheet as { name?: unknown; rows?: unknown };
    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      throw new Error(`Sheet brain output sheets[${sheetIndex}].name must be a non-empty string.`);
    }
    if (!Array.isArray(candidate.rows)) {
      throw new Error(`Sheet brain output sheets[${sheetIndex}].rows must be an array.`);
    }

    const rows = candidate.rows.map((row, rowIndex): SheetCellValue[] => {
      if (!Array.isArray(row)) {
        throw new Error(`Sheet brain output sheets[${sheetIndex}].rows[${rowIndex}] must be an array.`);
      }
      return row.map((cell, cellIndex) => {
        if (!isSheetCellValue(cell)) {
          throw new Error(
            `Sheet brain output sheets[${sheetIndex}].rows[${rowIndex}][${cellIndex}] must be string, number, boolean, or null.`,
          );
        }
        return cell;
      });
    });

    return {
      name: candidate.name.trim().slice(0, 100),
      rows,
    };
  });

  return {
    title: output.title.trim(),
    sheets,
  };
}

export async function sheetExecutor(
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
  const sheetFiles = files.filter((f) => f.mimeType === 'application/vnd.google-apps.spreadsheet');

  const contexts = await Promise.all(
    sheetFiles.map(async (file) => {
      console.log(chalk.gray(`   reading sheet: ${file.name}...`));
      try {
        const content = await drive.getSheetContent(file.id);
        return `=== ${file.name} ===\n${content}`;
      } catch (err) {
        console.log(
          chalk.yellow(`   warning: could not read sheet "${file.name}": ${String(err)}`),
        );
        return `=== ${file.name} ===\n[unavailable]`;
      }
    }),
  );

  const brain = resolveBrain(config, 'sheet');

  const userPrompt = [
    `Task: ${task.title}`,
    task.context !== undefined ? `\nContext:\n${task.context}` : '',
    contexts.length > 0 ? `\n\nGoogle Drive Content:\n${contexts.join('\n\n')}` : '',
    `\nCreate the requested spreadsheet based on the content above.`,
    `Return only JSON. Do not wrap it in Markdown.`,
  ].join('');

  console.log(chalk.gray(`   running brain: ${config.brain.sheet ?? config.brain.default}...`));
  const result = await brain.run({ systemPrompt: SHEET_SYSTEM_PROMPT, userPrompt });
  const output = parseSheetBrainOutput(result.text);

  console.log(chalk.gray(`   ensuring Drive output folder docs...`));
  const outputFolder = await drive.ensureFolder(project.google_drive_folder_id, 'docs');

  console.log(chalk.gray(`   creating Google Sheet: ${output.title}...`));
  const created = await drive.createSheet(outputFolder.id, output.title, output.sheets);
  if (created.webViewLink === undefined) {
    throw new Error(`Google Drive did not return a webViewLink for sheet: ${created.id}`);
  }

  console.log(chalk.gray(`   sharing Google Sheet publicly...`));
  await drive.sharePublicRead(created.id);

  console.log(chalk.green(`   sheet task complete`));
  return { outputUrl: created.webViewLink, brainUsed: result.brainUsed };
}

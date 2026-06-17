import { Command } from 'commander';
import chalk from 'chalk';
import { getMachineConfig } from '../../config.js';
import { GoogleDriveClient, type DriveFile } from '../../integrations/google-drive.js';
import { resolveBrain } from '../../brains/router.js';

const PREVIEW_CHARS = 500;

const MIME_TYPES = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slide: 'application/vnd.google-apps.presentation',
} as const;

type FileType = keyof typeof MIME_TYPES;

const DEMO_SYSTEM_PROMPT = `You are Han AI — a document assistant.
You have been given the content of files retrieved from Google Drive.
Complete the task using the provided content as context.`;

function printSection(label: string): void {
  console.log(chalk.cyan(`\n── ${label} ──`));
}

function printFilePreview(name: string, content: string): void {
  const preview = content.length > PREVIEW_CHARS ? content.slice(0, PREVIEW_CHARS) : content;
  console.log(chalk.bold(`\n  ${name}`));
  console.log(chalk.white(preview));
  if (content.length > PREVIEW_CHARS) {
    console.log(chalk.yellow(`  ... [truncated — showing first ${PREVIEW_CHARS} of ${content.length} chars]`));
  }
}

async function readFileContent(drive: GoogleDriveClient, file: DriveFile): Promise<string> {
  switch (file.mimeType) {
    case MIME_TYPES.doc:
      return drive.getDocContent(file.id);
    case MIME_TYPES.sheet:
      return drive.getSheetContent(file.id);
    case MIME_TYPES.slide:
      return drive.getSlideContent(file.id);
    default:
      return '[unsupported file type]';
  }
}

interface DemoOptions {
  type?: string;
  task?: string;
  brain: boolean; // commander maps --no-brain → opts.brain = false
}

export function demoCommand(): Command {
  return new Command('demo')
    .description('Demo Google Drive file retrieval (no Notion or Redis required)')
    .argument('<folder-id>', 'Google Drive folder ID')
    .option('--type <type>', 'Filter file type: doc, sheet, or slide (default: all)')
    .option('--task <description>', 'Task to run through the brain after retrieval')
    .option('--no-brain', 'Skip the brain step — just show retrieved content')
    .action(async (folderId: string, opts: DemoOptions) => {
      const config = getMachineConfig();
      if (!config) {
        console.error(chalk.red('❌ Run `han init` first — ~/.han/config.json not found'));
        process.exit(1);
      }
      if (config.google_key_path === undefined) {
        console.error(chalk.red('❌ google_key_path not set in ~/.han/config.json'));
        console.error(chalk.gray('   Add: { "google_key_path": "/path/to/service-account.json" }'));
        process.exit(1);
      }

      if (opts.type !== undefined && !['doc', 'sheet', 'slide'].includes(opts.type)) {
        console.error(chalk.red(`❌ Invalid --type "${opts.type}" — must be doc, sheet, or slide`));
        process.exit(1);
      }
      const typeFilter = opts.type as FileType | undefined;
      const skipBrain = opts.brain === false;

      console.log(chalk.cyan('\n Han Demo — Google Drive File Retrieval\n'));
      console.log(chalk.gray(`   folder-id : ${folderId}`));
      console.log(chalk.gray(`   type      : ${typeFilter ?? 'all'}`));
      console.log(chalk.gray(`   brain     : ${skipBrain ? 'skipped (--no-brain)' : 'enabled'}`));

      let drive: GoogleDriveClient;
      try {
        drive = new GoogleDriveClient({
          keyPath: config.google_key_path,
          ...(config.google_oauth_token_path !== undefined && { oauthTokenPath: config.google_oauth_token_path }),
        });
      } catch (err) {
        console.error(chalk.red(`❌ Failed to init Google Drive client: ${String(err)}`));
        process.exit(1);
      }

      printSection('Listing Files');
      let allFiles: DriveFile[];
      try {
        console.log(chalk.gray('   fetching...'));
        allFiles = await drive.listFiles(folderId);
      } catch (err) {
        console.error(chalk.red(`❌ Failed to list files: ${String(err)}`));
        process.exit(1);
      }

      const targetMimeTypes = typeFilter
        ? [MIME_TYPES[typeFilter]]
        : (Object.values(MIME_TYPES) as string[]);
      const files = allFiles.filter((f) => targetMimeTypes.includes(f.mimeType));

      console.log(chalk.green(`   ${allFiles.length} total file(s), ${files.length} match filter`));
      for (const f of allFiles) {
        const included = files.some((t) => t.id === f.id);
        console.log(
          `${included ? chalk.green('  ✓') : chalk.gray('  -')} ${f.name} ${chalk.gray(`(${f.mimeType})`)}`,
        );
      }

      if (files.length === 0) {
        console.log(chalk.yellow('\nNo files match the filter. Exiting.'));
        return;
      }

      printSection('Reading Content');
      const contexts: string[] = [];
      for (const file of files) {
        console.log(chalk.gray(`   reading: ${file.name}...`));
        try {
          const content = await readFileContent(drive, file);
          contexts.push(`=== ${file.name} ===\n${content}`);
          printFilePreview(file.name, content);
        } catch (err) {
          console.log(chalk.yellow(`   warning: could not read "${file.name}": ${String(err)}`));
          contexts.push(`=== ${file.name} ===\n[unavailable]`);
        }
      }

      if (skipBrain) {
        console.log(chalk.cyan('\n✅ Done (brain skipped)\n'));
        return;
      }

      const taskDescription = opts.task ?? 'Summarize the content of these files.';
      printSection('Running Brain');

      let brain;
      try {
        brain = resolveBrain(config, 'doc');
      } catch (err) {
        console.error(chalk.red(`❌ Failed to resolve brain: ${String(err)}`));
        process.exit(1);
      }

      const userPrompt = [
        `Task: ${taskDescription}`,
        contexts.length > 0 ? `\n\nGoogle Drive Content:\n${contexts.join('\n\n')}` : '',
        `\n\nComplete the task based on the content above.`,
      ].join('');

      console.log(chalk.gray(`   brain: ${config.brain.doc ?? config.brain.default}`));
      console.log(chalk.gray(`   task : ${taskDescription}`));

      try {
        const result = await brain.run({ systemPrompt: DEMO_SYSTEM_PROMPT, userPrompt });
        printSection('Brain Output');
        console.log(chalk.white(result.text));
        console.log(chalk.cyan(`\n✅ Done (brain: ${result.brainUsed})\n`));
      } catch (err) {
        console.error(chalk.red(`❌ Brain failed: ${String(err)}`));
        process.exit(1);
      }
    });
}

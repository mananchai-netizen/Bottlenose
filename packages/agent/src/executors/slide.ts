import chalk from 'chalk';
import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';
import type { ExecutorResult } from './index.js';
import { resolveBrain } from '../brains/router.js';
import { GoogleDriveClient, type DrivePresentationSlide } from '../integrations/google-drive.js';
import { parseJsonObjectFromBrainOutput } from './json-output.js';

const SLIDE_SYSTEM_PROMPT = `You are Han AI — an autonomous presentation analyst agent.
You have been given the text content of Google Slides from a project folder.
Note: only text shapes are extracted — images, charts, tables, speaker notes, and embedded media are not available.
Complete the task using the slide content as context.
Return only valid JSON with this shape:
{
  "title": "Google Slides title",
  "slides": [
    {
      "title": "Slide title",
      "bullets": ["Bullet one", "Bullet two"]
    }
  ]
}`;

interface SlideBrainOutput {
  title: string;
  slides: DrivePresentationSlide[];
}

function parseSlideBrainOutput(text: string): SlideBrainOutput {
  const parsed = parseJsonObjectFromBrainOutput(text, 'Slide brain output');

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Slide brain output must be a JSON object.');
  }

  const output = parsed as { title?: unknown; slides?: unknown };
  if (typeof output.title !== 'string' || output.title.trim().length === 0) {
    throw new Error('Slide brain output must include a non-empty string "title".');
  }
  if (!Array.isArray(output.slides) || output.slides.length === 0) {
    throw new Error('Slide brain output must include a non-empty "slides" array.');
  }

  const slides = output.slides.map((slide, slideIndex): DrivePresentationSlide => {
    if (typeof slide !== 'object' || slide === null) {
      throw new Error(`Slide brain output slides[${slideIndex}] must be an object.`);
    }

    const candidate = slide as { title?: unknown; bullets?: unknown };
    if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
      throw new Error(`Slide brain output slides[${slideIndex}].title must be a non-empty string.`);
    }
    if (!Array.isArray(candidate.bullets)) {
      throw new Error(`Slide brain output slides[${slideIndex}].bullets must be an array.`);
    }

    return {
      title: candidate.title.trim(),
      bullets: candidate.bullets
        .map((bullet, bulletIndex) => {
          if (typeof bullet !== 'string') {
            throw new Error(`Slide brain output slides[${slideIndex}].bullets[${bulletIndex}] must be a string.`);
          }
          return bullet.trim();
        })
        .filter((bullet) => bullet.length > 0),
    };
  });

  return {
    title: output.title.trim(),
    slides,
  };
}

export async function slideExecutor(
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
  const slideFiles = files.filter((f) => f.mimeType === 'application/vnd.google-apps.presentation');

  const contexts = await Promise.all(
    slideFiles.map(async (file) => {
      console.log(chalk.gray(`   reading slides: ${file.name}...`));
      try {
        const content = await drive.getSlideContent(file.id);
        return `=== ${file.name} ===\n${content}`;
      } catch (err) {
        console.log(
          chalk.yellow(`   warning: could not read slides "${file.name}": ${String(err)}`),
        );
        return `=== ${file.name} ===\n[unavailable]`;
      }
    }),
  );

  const brain = resolveBrain(config, 'slide');

  const userPrompt = [
    `Task: ${task.title}`,
    task.context !== undefined ? `\nContext:\n${task.context}` : '',
    contexts.length > 0 ? `\n\nGoogle Drive Content:\n${contexts.join('\n\n')}` : '',
    `\nCreate the requested presentation based on the content above.`,
    `Return only JSON. Do not wrap it in Markdown.`,
  ].join('');

  console.log(chalk.gray(`   running brain: ${config.brain.slide ?? config.brain.default}...`));
  const result = await brain.run({ systemPrompt: SLIDE_SYSTEM_PROMPT, userPrompt });
  const output = parseSlideBrainOutput(result.text);

  console.log(chalk.gray(`   ensuring Drive output folder docs...`));
  const outputFolder = await drive.ensureFolder(project.google_drive_folder_id, 'docs');

  console.log(chalk.gray(`   creating Google Slides: ${output.title}...`));
  const created = await drive.createSlide(outputFolder.id, output.title, output.slides);
  if (created.webViewLink === undefined) {
    throw new Error(`Google Drive did not return a webViewLink for slides: ${created.id}`);
  }

  console.log(chalk.gray(`   sharing Google Slides publicly...`));
  await drive.sharePublicRead(created.id);

  console.log(chalk.green(`   slide task complete`));
  return { outputUrl: created.webViewLink, brainUsed: result.brainUsed };
}

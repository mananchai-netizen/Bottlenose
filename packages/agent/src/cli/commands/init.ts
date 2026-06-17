import { Command } from 'commander';
import inquirer from 'inquirer';

const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
import chalk from 'chalk';
import os from 'os';
import { saveMachineConfig, getMachineConfig } from '../../config.js';
import type { MachineConfig, TaskType, BrainName } from '../../types.js';

export function initCommand(): Command {
  return new Command('init')
    .description('Setup machine config (API keys, brain, accept_types)')
    .action(async () => {
      const existing = getMachineConfig();

      console.log(chalk.cyan('\n🤖 Han AI — Machine Setup\n'));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'machine_name',
          message: 'Machine name:',
          default: existing?.machine_name ?? os.hostname(),
        },
        {
          type: 'checkbox',
          name: 'accept_types',
          message: 'Accept task types:',
          choices: ['dev', 'doc', 'sheet', 'slide'],
          default: existing?.accept_types ?? ['dev'],
        },
        {
          type: 'list',
          name: 'default_brain',
          message: 'Default brain:',
          choices: [
            'claude-cli',
            'claude-sonnet-4-6',
            'claude-opus-4-7',
            'gemini-2.5-pro',
            'gemini-2.0-flash',
            'llm-server',
            'claude-api-sonnet',
            'claude-api-opus',
            'openrouter',
          ] satisfies BrainName[],
          default: existing?.brain.default ?? 'claude-cli',
        },
        {
          type: 'input',
          name: 'notion_token',
          message: 'Notion API key:',
          default: existing?.notion_token ?? '',
        },
        {
          type: 'input',
          name: 'claude_api_key',
          message: 'Claude API key (leave blank to skip):',
          default: existing?.claude_api_key ?? '',
        },
        {
          type: 'input',
          name: 'gemini_api_key',
          message: 'Gemini API key (leave blank to skip):',
          default: existing?.gemini_api_key ?? '',
        },
        {
          type: 'input',
          name: 'openrouter_api_key',
          message: 'OpenRouter API key (leave blank to skip):',
          default: existing?.openrouter_api_key ?? '',
        },
        {
          type: 'input',
          name: 'openrouter_model',
          message: 'OpenRouter model:',
          default: existing?.openrouter_model ?? DEFAULT_OPENROUTER_MODEL,
          when: (ans: Record<string, unknown>) => (ans['openrouter_api_key'] as string).length > 0,
        },
        {
          type: 'input',
          name: 'redis_url',
          message: 'Redis URL:',
          default: existing?.redis_url ?? 'redis://localhost:6379',
        },
        {
          type: 'input',
          name: 'discord_token',
          message: 'Discord Bot token (leave blank to skip):',
          default: existing?.discord_token ?? '',
        },
        {
          type: 'number',
          name: 'poll_interval',
          message: 'Poll interval (seconds):',
          default: existing?.poll_interval ?? 30,
        },
      ]);

      const machineName = answers['machine_name'] as string;
      const machineId = machineName.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const config: MachineConfig = {
        machine_id: machineId,
        machine_name: machineName,
        accept_types: (answers['accept_types'] as string[]) as TaskType[],
        brain: { default: answers['default_brain'] as BrainName },
        notion_token: answers['notion_token'] as string,
        redis_url: answers['redis_url'] as string,
        poll_interval: (answers['poll_interval'] as number | undefined) ?? 30,
        max_concurrent_tasks: 1,
      };

      // optional fields — ใส่เฉพาะถ้ามีค่า (exactOptionalPropertyTypes safe)
      const claudeKey = answers['claude_api_key'] as string;
      if (claudeKey.length > 0) config.claude_api_key = claudeKey;

      const geminiKey = answers['gemini_api_key'] as string;
      if (geminiKey.length > 0) config.gemini_api_key = geminiKey;

      const orKey = answers['openrouter_api_key'] as string;
      if (orKey.length > 0) config.openrouter_api_key = orKey;
      const orModel = answers['openrouter_model'] as string | undefined;
      if (orModel && orModel.length > 0) config.openrouter_model = orModel;

      const discordToken = answers['discord_token'] as string;
      if (discordToken.length > 0) config.discord_token = discordToken;

      saveMachineConfig(config);

      console.log(chalk.green('\n✅ Config saved!'));
      console.log(chalk.gray(`   machine_id: ${config.machine_id}`));
      console.log(chalk.gray(`   config path: ~/.han/config.json`));
      console.log(chalk.cyan('\nNext: add a project via `han ui` then run `han start`\n'));
    });
}

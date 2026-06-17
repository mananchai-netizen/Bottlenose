import { Command } from 'commander';
import { execSync } from 'child_process';
import chalk from 'chalk';

export function uiCommand(): Command {
  return new Command('ui')
    .description('Open Han AI config UI in browser')
    .action(() => {
      const url = 'http://localhost:3100';
      console.log(chalk.cyan(`\n🌐 Opening Han AI UI → ${url}\n`));
      try {
        execSync(`open "${url}"`);
      } catch {
        console.log(chalk.gray(`Run \`npm run dev\` in han-ai directory first, then open ${url}`));
      }
    });
}

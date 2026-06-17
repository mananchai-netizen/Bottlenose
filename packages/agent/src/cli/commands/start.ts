import { Command } from 'commander';
import chalk from 'chalk';
import { getMachineConfig } from '../../config.js';
import { startWorker, startWorkerOnce } from '../../worker/index.js';

export function startCommand(): Command {
  return new Command('start')
    .description('Start the worker process')
    .action(async () => {
      if (process.env.HAN_START_MODE === 'once') {
        await startWorkerOnce();
        return;
      }

      const config = getMachineConfig();
      if (!config) {
        console.error(chalk.red('❌ Run `han init` first'));
        process.exit(1);
      }
      await startWorker();
    });
}

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { uiCommand } from './commands/ui.js';
import { demoCommand } from './commands/demo.js';
import { googleAuthCommand } from './commands/google-auth.js';

const program = new Command();

program
  .name('han')
  .description('Han AI — Multi-machine agent worker')
  .version('0.1.0');

program.addCommand(initCommand());
program.addCommand(startCommand());
program.addCommand(statusCommand());
program.addCommand(uiCommand());
program.addCommand(demoCommand());
program.addCommand(googleAuthCommand());

program.parse();

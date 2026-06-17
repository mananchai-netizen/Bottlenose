import { Command } from 'commander';
import chalk from 'chalk';
import { getMachineConfig } from '../../config.js';
import { RedisLock } from '../../worker/redis-lock.js';
import { MachineRegistry } from '../../worker/machine-registry.js';

export function statusCommand(): Command {
  return new Command('status')
    .description('Show machines and current tasks')
    .action(async () => {
      const config = getMachineConfig();
      if (!config) {
        console.error(chalk.red('❌ Run `han init` first'));
        process.exit(1);
      }

      const lock = new RedisLock(config.redis_url, config.machine_id);
      await lock.connect();

      const registry = new MachineRegistry(
        lock.getRedis(),
        config.machine_id,
        config.machine_name,
        config.accept_types,
      );

      const machines = await registry.listAll();

      console.log(chalk.cyan('\n📊 Han AI — Machine Status\n'));

      if (!machines.length) {
        console.log(chalk.gray('  No machines registered'));
      } else {
        for (const m of machines) {
          const statusColor = m.status === 'online' ? chalk.green : chalk.gray;
          const statusIcon = m.status === 'online' ? '🟢' : '⚫';
          console.log(
            `  ${statusIcon} ${statusColor(m.machine_name.padEnd(15))} ` +
            `${m.status.padEnd(8)} ` +
            (m.current_task ? chalk.yellow(`task: ${m.current_task}`) : chalk.gray('idle')),
          );
        }
      }

      console.log();
      await lock.disconnect();
    });
}

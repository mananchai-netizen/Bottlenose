import type { HanTask, MachineConfig, ProjectConfig } from '../types.js';
import { devExecutor } from './dev.js';
import { docExecutor } from './doc.js';
import { sheetExecutor } from './sheet.js';
import { slideExecutor } from './slide.js';

export interface ExecutorResult {
  outputUrl?: string;
  brainUsed?: string;
}

export async function executeTask(
  task: HanTask,
  config: MachineConfig,
  project: ProjectConfig,
): Promise<ExecutorResult> {
  switch (task.type) {
    case 'dev':
      return devExecutor(task, config, project);
    case 'doc':
      return docExecutor(task, config, project);
    case 'sheet':
      return sheetExecutor(task, config, project);
    case 'slide':
      return slideExecutor(task, config, project);
    default: {
      const _exhaustive: never = task.type;
      throw new Error(`Unknown task type: ${String(_exhaustive)}`);
    }
  }
}

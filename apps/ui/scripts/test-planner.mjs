import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { runGoogleDriveTaskAgentDirect } = await import('../../../packages/agent/dist/planning/google-drive-task-planner.js');

console.log('Running planner for project p1 → creating tasks on Notion ...\n');
try {
  const result = await runGoogleDriveTaskAgentDirect({
    projectId: 'p1',
    dryRun: false,
  });

  console.log(`\nBrain used: ${result.brainUsed}`);
  console.log(`Tasks created: ${result.created.length}\n`);
  for (const task of result.created) {
    console.log(`✅ ${task.title}`);
    if (task.url) console.log(`   ${task.url}`);
  }
} catch (err) {
  console.error('❌ Planner error:', err.message);
}

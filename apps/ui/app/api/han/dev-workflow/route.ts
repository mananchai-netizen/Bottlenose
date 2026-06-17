import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { CRON_SECRET, APP_URL, getServerConfig } from '@/lib/server-config'
import { devWorkflow } from '@/lib/workflows/dev-workflow'

export const maxDuration = 300

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    task: { id: string; notion_page_id: string; title: string; type: string; retry_count: number; context?: string }
    project: { notion_db_id: string; github_repo: string; github_token?: string }
    lockKey: string
  }

  const { NOTION_TOKEN, REDIS_URL, HAN_MACHINE_ID, GITHUB_TOKEN, QWEN_RUNPOD_URL, QWEN_RUNPOD_TOKEN, QWEN_MODEL_NAME } = await getServerConfig()
  const run = await start(devWorkflow, [{
    taskId: body.task.id,
    taskTitle: body.task.title,
    taskContext: body.task.context ?? undefined,
    notionPageId: body.task.notion_page_id,
    githubRepo: body.project.github_repo,
    githubToken: body.project.github_token ?? GITHUB_TOKEN,
    notionToken: NOTION_TOKEN,
    redisUrl: REDIS_URL,
    lockKey: body.lockKey,
    machineId: HAN_MACHINE_ID,
    appUrl: APP_URL,
    cronSecret: CRON_SECRET,
    qwenUrl: QWEN_RUNPOD_URL,
    qwenToken: QWEN_RUNPOD_TOKEN,
    qwenModel: QWEN_MODEL_NAME,
  }])

  return NextResponse.json({ status: 'started', runId: run.runId })
}

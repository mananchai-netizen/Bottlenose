import { getServerConfig } from './server-config'

interface RunPodChoice {
  tokens?: string[]
  message?: { content: string }
}

interface RunPodOutput {
  choices?: RunPodChoice[]
}

interface RunPodResponse {
  id: string
  status: 'COMPLETED' | 'FAILED' | 'IN_QUEUE' | 'IN_PROGRESS' | 'CANCELLED'
  output?: RunPodOutput[] | RunPodOutput | string
  error?: string
}

const POLL_INTERVAL_MS = 3_000
const MAX_WAIT_MS = 10 * 60 * 1_000  // 10 minutes

function extractResult(data: RunPodResponse): string {
  if (typeof data.output === 'string') return data.output
  if (Array.isArray(data.output)) {
    const first = data.output[0]?.choices?.[0]
    return first?.tokens?.[0] ?? first?.message?.content ?? ''
  }
  return data.output?.choices?.[0]?.message?.content ?? ''
}

export async function callQwen(system: string, user: string): Promise<string> {
  const { QWEN_RUNPOD_URL: url, QWEN_RUNPOD_TOKEN: token, QWEN_MODEL_NAME } = await getServerConfig()

  if (!url) throw new Error('QWEN_RUNPOD_URL not set')

  // แปลง .../runsync → .../run และ .../status
  const runUrl = url.replace(/\/runsync$/, '/run')
  const statusBase = url.replace(/\/runsync$/, '/status')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const body = JSON.stringify({
    input: {
      model: QWEN_MODEL_NAME,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    },
  })

  console.log('[callQwen] submit', { model: QWEN_MODEL_NAME, systemLen: system.length, userLen: user.length })
  const t0 = Date.now()

  const submitRes = await fetch(runUrl, { method: 'POST', headers, body })
  if (!submitRes.ok) {
    throw new Error(`Qwen RunPod submit error ${submitRes.status}: ${await submitRes.text()}`)
  }

  const submitted = (await submitRes.json()) as RunPodResponse
  const jobId = submitted.id
  console.log('[callQwen] job submitted', { jobId, status: submitted.status })

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const statusRes = await fetch(`${statusBase}/${jobId}`, { headers })
    if (!statusRes.ok) {
      console.warn('[callQwen] status check failed', { status: statusRes.status })
      continue
    }

    const data = (await statusRes.json()) as RunPodResponse
    console.log('[callQwen] poll', { jobId, status: data.status, elapsedMs: Date.now() - t0 })

    if (data.status === 'FAILED') {
      throw new Error(`Qwen RunPod job failed: ${data.error ?? 'unknown error'}`)
    }
    if (data.status === 'CANCELLED') {
      throw new Error(`Qwen RunPod job was cancelled (jobId: ${jobId})`)
    }
    if (data.status === 'COMPLETED') {
      const result = extractResult(data)
      console.log('[callQwen] done', { jobId, outputLen: result.length, totalMs: Date.now() - t0 })
      return result
    }
    // IN_QUEUE / IN_PROGRESS → poll ต่อ
  }

  throw new Error(`Qwen RunPod job timed out after ${MAX_WAIT_MS / 1000}s (jobId: ${jobId})`)
}

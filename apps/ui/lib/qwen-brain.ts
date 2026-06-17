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

export async function callQwen(system: string, user: string): Promise<string> {
  const { QWEN_RUNPOD_URL: url, QWEN_RUNPOD_TOKEN: token, QWEN_MODEL_NAME } = await getServerConfig()

  console.log('[callQwen] start', { model: QWEN_MODEL_NAME, systemLen: system.length, userLen: user.length })

  if (!url) throw new Error('QWEN_RUNPOD_URL not set')

  console.log('[callQwen] → RunPod Serverless request', { url, model: QWEN_MODEL_NAME })
  const t0 = Date.now()

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      input: {
        model: QWEN_MODEL_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 8192,
        temperature: 0.1,
      },
    }),
  })

  console.log('[callQwen] ← RunPod response', { status: res.status, durationMs: Date.now() - t0 })

  if (!res.ok) {
    const body = await res.text()
    console.error('[callQwen] RunPod HTTP error', { status: res.status, body })
    throw new Error(`Qwen RunPod error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as RunPodResponse

  console.log('[callQwen] raw response:', JSON.stringify(data, null, 2))

  if (data.status === 'FAILED') {
    console.error('[callQwen] RunPod job failed', { error: data.error })
    throw new Error(`Qwen RunPod job failed: ${data.error ?? 'unknown error'}`)
  }

  let result = ''
  if (typeof data.output === 'string') {
    result = data.output
  } else if (Array.isArray(data.output)) {
    // RunPod serverless: output is an array of { choices: [{ tokens: ["..."] }] }
    const firstChoice = data.output[0]?.choices?.[0]
    result = firstChoice?.tokens?.[0] ?? firstChoice?.message?.content ?? ''
  } else if (data.output?.choices?.[0]?.message?.content) {
    result = data.output.choices[0].message.content
  }

  console.log('[callQwen] done', { jobStatus: data.status, outputLen: result.length, totalMs: Date.now() - t0 })

  return result
}

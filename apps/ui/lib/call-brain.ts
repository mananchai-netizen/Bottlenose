import Anthropic from '@anthropic-ai/sdk'
import { callQwen } from './qwen-brain'
import { getServerConfig } from './server-config'

const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet'

export async function callBrain(system: string, user: string): Promise<string> {
  const cfg = await getServerConfig()
  const brainName = cfg.HAN_BRAIN

  if (brainName === 'qwen-runpod' || brainName === 'qwen3-max') {
    return callQwen(system, user)
  }

  if (brainName === 'openrouter') {
    const apiKey = cfg.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY
    const model = cfg.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 8096,
      }),
    })
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message.content ?? ''
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  const model = brainName === 'claude-api-opus' ? 'claude-opus-4-7' : 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model,
    max_tokens: 8096,
    system,
    messages: [{ role: 'user', content: user }],
  })
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
}

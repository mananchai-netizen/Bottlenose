import { callQwen } from '@/lib/qwen-brain'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const { system, user } = (await req.json()) as { system?: string; user: string }
    if (!user?.trim()) {
      return Response.json({ error: 'user prompt is required' }, { status: 400 })
    }
    const text = await callQwen(system ?? 'You are a helpful assistant.', user)
    return Response.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

import Anthropic from '@anthropic-ai/sdk';
import type { Brain, BrainRequest, BrainResponse } from './types.js';

export class ClaudeAPIBrain implements Brain {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async run(req: BrainRequest): Promise<BrainResponse> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const message = await client.messages.create({
      model: this.model,
      max_tokens: 8096,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    });
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    return { text, brainUsed: this.model };
  }
}

export class OpenRouterBrain implements Brain {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async run(req: BrainRequest): Promise<BrainResponse> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
        max_tokens: 8096,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const text = data.choices[0]?.message.content ?? '';
    return { text, brainUsed: this.model };
  }
}

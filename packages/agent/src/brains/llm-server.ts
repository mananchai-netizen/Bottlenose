import type { Brain, BrainRequest, BrainResponse } from './types.js';

interface LLMServerResponse {
  choices?: Array<{ message?: { content?: string } }>;
  content?: string;
  text?: string;
}

export class LLMServerBrain implements Brain {
  constructor(
    private readonly serverUrl: string,
    private readonly token?: string,
  ) {}

  async run(req: BrainRequest): Promise<BrainResponse> {
    const res = await fetch(`${this.serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token !== undefined && this.token.length > 0 && { Authorization: `Bearer ${this.token}` }),
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM server error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as LLMServerResponse;
    const text =
      data.choices?.[0]?.message?.content ??
      data.content ??
      data.text ??
      '';

    return { text, brainUsed: 'llm-server' };
  }
}

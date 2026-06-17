import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Brain, BrainRequest, BrainResponse } from './types.js';

export interface ClaudeCliBrainOptions {
  model?: string;         // 'sonnet' | 'opus' | full model id
  claudeBin?: string;     // path to claude binary (default: 'claude')
  workspaceDir?: string;  // --add-dir (optional)
}

interface CCAssistantEvent {
  type: 'assistant';
  message: { content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string }> };
}
interface CCResultEvent {
  type: 'result';
  result?: string;
  is_error?: boolean;
}
type CCEvent = CCAssistantEvent | CCResultEvent | { type: string };

export class ClaudeCliBrain implements Brain {
  private readonly opts: ClaudeCliBrainOptions;

  constructor(opts: ClaudeCliBrainOptions = {}) {
    this.opts = opts;
  }

  async run(req: BrainRequest): Promise<BrainResponse> {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'text',
      '--model', this.opts.model ?? 'sonnet',
      '--append-system-prompt', req.systemPrompt,
      '--no-session-persistence',
      '--dangerously-skip-permissions',
    ];
    const wsDir = req.workspaceDir ?? this.opts.workspaceDir;
    if (wsDir !== undefined) {
      args.push('--add-dir', wsDir);
    }

    const proc: ChildProcessWithoutNullStreams = spawn(this.opts.claudeBin ?? 'claude', args, {
      ...(wsDir !== undefined ? { cwd: wsDir } : {}),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.write(req.userPrompt);
    proc.stdin.end();

    const stderrBuf: string[] = [];
    proc.stderr.on('data', (d: Buffer) => stderrBuf.push(d.toString()));

    let stdoutBuf = '';
    const lineQueue: string[] = [];
    let resolveLine: ((v: void) => void) | null = null;
    let closed = false;
    let closeErr: Error | null = null;

    proc.stdout.on('data', (d: Buffer) => {
      stdoutBuf += d.toString();
      const parts = stdoutBuf.split('\n');
      stdoutBuf = parts.pop() ?? '';
      for (const p of parts) {
        if (p.trim()) lineQueue.push(p);
      }
      resolveLine?.();
      resolveLine = null;
    });

    proc.on('close', (code: number | null) => {
      if (stdoutBuf.trim()) lineQueue.push(stdoutBuf);
      closed = true;
      if (code !== 0) {
        closeErr = new Error(`claude exited ${code}: ${stderrBuf.join('').slice(0, 300)}`);
      }
      resolveLine?.();
      resolveLine = null;
    });

    proc.on('error', (err: Error) => {
      closed = true;
      closeErr = err;
      resolveLine?.();
      resolveLine = null;
    });

    const textParts: string[] = [];
    let sawResult = false;

    while (true) {
      if (lineQueue.length === 0) {
        if (closed) break;
        await new Promise<void>((r) => { resolveLine = r; });
        continue;
      }

      const line = lineQueue.shift()!;
      let event: CCEvent;
      try {
        event = JSON.parse(line) as CCEvent;
      } catch {
        continue;
      }

      if (event.type === 'assistant') {
        const ev = event as CCAssistantEvent;
        for (const block of ev.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
      } else if (event.type === 'result') {
        const ev = event as CCResultEvent;
        sawResult = true;
        if (ev.is_error === true) {
          throw new Error(`claude result error: ${ev.result ?? 'unknown'}`);
        }
        if (ev.result !== undefined && textParts.length === 0) {
          textParts.push(ev.result);
        }
      }
    }

    if (closeErr !== null && !sawResult) throw closeErr;

    return {
      text: textParts.join(''),
      brainUsed: `claude-cli:${this.opts.model ?? 'sonnet'}`,
    };
  }
}

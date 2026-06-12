import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface NdjsonEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'exit';
  data: unknown;
  raw?: string;
}

/**
 * Spawns a CLI subprocess and streams parsed NDJSON events.
 * Line-buffers stdout to ensure clean JSON boundary parsing.
 */
export class SubprocessRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private lineBuffer = '';
  private stderrBuffer = '';
  private _pid: number | null = null;

  get pid(): number | null {
    return this._pid;
  }

  get running(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Spawn a CLI command and begin streaming NDJSON events.
   */
  start(command: string, args: string[], cwd: string): void {
    if (this.process) {
      throw new Error('SubprocessRunner already has an active process');
    }

    this.lineBuffer = '';
    this.stderrBuffer = '';
    this.process = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._pid = this.process.pid ?? null;

    this.process.stdin?.end();

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString();
      this.drainLines();
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    this.process.on('close', (code) => {
      this.drainLines();
      if (code !== 0 && this.stderrBuffer.trim()) {
        this.emit('event', {
          type: 'error',
          data: { message: this.stderrBuffer.trim() },
        } satisfies NdjsonEvent);
      }
      this.stderrBuffer = '';
      this.emit('event', {
        type: 'exit',
        data: { code },
      } satisfies NdjsonEvent);
      this.emit('exit', code);
      this.process = null;
      this._pid = null;
    });

    this.process.on('error', (err) => {
      this.emit('event', {
        type: 'error',
        data: { message: err.message },
      } satisfies NdjsonEvent);
    });
  }

  /**
   * Write to subprocess stdin (for interactive prompts).
   */
  write(data: string): void {
    this.process?.stdin?.write(data);
  }

  /**
   * Gracefully terminate the subprocess.
   */
  kill(): void {
    if (!this.process) return;
    try {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 3000);
    } catch {
      // already exited
    }
  }

  private drainLines(): void {
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const event = this.mapToEvent(parsed);
        if (event) {
          this.emit('event', event);
        }
      } catch {
        if (trimmed.length > 0 && !this.isNoiseLine(trimmed)) {
          this.emit('event', {
            type: 'text_delta',
            data: { text: trimmed },
            raw: trimmed,
          } satisfies NdjsonEvent);
        }
      }
    }
  }

  private isNoiseLine(line: string): boolean {
    return /^\[[\w-]+\]\s/.test(line) ||
      /plugin\s+load/i.test(line) ||
      /^(debug|info|warn(ing)?|trace)[\s:]/i.test(line);
  }

  private mapToEvent(obj: Record<string, unknown>): NdjsonEvent | null {
    const t = obj.type as string | undefined;

    // ── Claude Code stream-json: {"type":"assistant","message":{"type":"text","text":"..."}}
    if (t === 'assistant' && typeof obj.message === 'object') {
      const msg = obj.message as Record<string, unknown>;
      if (msg.type === 'text' && typeof msg.text === 'string') {
        return { type: 'text_delta', data: { text: msg.text } };
      }
    }

    // ── Anthropic API streaming: content_block_delta
    if (t === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return { type: 'text_delta', data: { text: delta.text } };
      }
    }

    // ── Codex JSONL: response.output_text.delta → streaming text
    if (t === 'response.output_text.delta' && typeof obj.delta === 'string') {
      return { type: 'text_delta', data: { text: obj.delta } };
    }

    // ── Codex JSONL: response.output_text.done → final text block
    if (t === 'response.output_text.done' && typeof obj.text === 'string') {
      return null; // already received via deltas
    }

    // ── Codex JSONL: item.completed with message content
    if (t === 'item.completed' && typeof obj.item === 'object' && obj.item) {
      const item = obj.item as Record<string, unknown>;
      if (item.type === 'message' && Array.isArray(item.content)) {
        const parts = item.content as Record<string, unknown>[];
        const texts = parts
          .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
          .map((c) => c.text as string);
        if (texts.length) {
          return { type: 'text_delta', data: { text: texts.join('') } };
        }
      }
    }

    // ── OpenCode JSON: {"type":"text","part":{"type":"text","text":"..."}}
    if (t === 'text' && typeof obj.part === 'object' && obj.part) {
      const part = obj.part as Record<string, unknown>;
      if (typeof part.text === 'string') {
        return { type: 'text_delta', data: { text: part.text } };
      }
    }

    // ── OpenCode JSON fallback: {"type":"assistant","content":"..."}
    if (t === 'assistant' && typeof obj.content === 'string') {
      return { type: 'text_delta', data: { text: obj.content } };
    }

    // ── Tool events (all CLIs)
    if (t === 'tool_use' || t === 'tool_call' || t === 'response.function_call_arguments.done') {
      return { type: 'tool_call', data: obj };
    }
    if (t === 'tool_result' || t === 'response.output_item.done') {
      return { type: 'tool_result', data: obj };
    }

    // ── OpenCode tool call: {"type":"tool_call_start","part":{"name":"...","id":"..."}}
    if (t === 'tool_call_start' && typeof obj.part === 'object' && obj.part) {
      return { type: 'tool_call', data: obj.part };
    }
    if (t === 'tool_call_result') {
      return { type: 'tool_result', data: obj };
    }

    // ── Progress / lifecycle events
    if (
      t === 'message_start' || t === 'message_stop' ||
      t === 'step_start' || t === 'step_finish' ||
      t === 'thread.started' || t === 'turn.started' || t === 'turn.completed' ||
      t === 'response.created' || t === 'response.completed' ||
      t === 'response.output_item.added'
    ) {
      return { type: 'progress', data: obj };
    }

    return null;
  }
}

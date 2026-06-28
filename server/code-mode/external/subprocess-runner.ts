import { spawn, type ChildProcess, type StdioOptions } from 'child_process';
import { EventEmitter } from 'events';
import { parseCliJsonEvent } from './subprocess-io';
import { BENIGN_STDERR, type NdjsonEvent, type SubprocessStartOptions } from './subprocess-types';

// Re-export public symbols so existing consumers don't break
export { parseCliJsonEvent } from './subprocess-io';
export type { NdjsonEvent, SubprocessStartOptions } from './subprocess-types';

/**
 * Spawns a CLI subprocess and streams parsed NDJSON events.
 * Line-buffers stdout to ensure clean JSON boundary parsing.
 */
export class SubprocessRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private lineBuffer = '';
  private stderrBuffer = '';
  private _pid: number | null = null;
  private receivedText = false;

  get pid(): number | null {
    return this._pid;
  }

  get running(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Spawn a CLI command and begin streaming NDJSON events.
   */
  start(command: string, args: string[], cwd: string, options: SubprocessStartOptions = {}): void {
    if (this.process) {
      throw new Error('SubprocessRunner already has an active process');
    }

    const stdinMode = options.stdin ?? 'ignore';
    const stdio: StdioOptions = [stdinMode, 'pipe', 'pipe'];

    this.lineBuffer = '';
    this.stderrBuffer = '';
    this.receivedText = false;
    this.process = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio,
    });

    this._pid = this.process.pid ?? null;

    if (stdinMode === 'pipe') {
      this.process.stdin?.end();
    }

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString();
      this.drainLines();
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    this.process.on('close', (code) => {
      this.drainLines();
      const stderr = this.stderrBuffer.trim();
      const showStderrError =
        code !== 0 &&
        stderr.length > 0 &&
        !BENIGN_STDERR.test(stderr) &&
        !this.receivedText;

      if (showStderrError) {
        this.emit('event', {
          type: 'error',
          data: { message: stderr },
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
      const proc = this.process;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
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
        const event = parseCliJsonEvent(parsed);
        if (event) {
          if (event.type === 'text_delta') {
            this.receivedText = true;
            this.emit('event', event);
          } else if (event.type === 'text_final') {
            // Only emit finalization text if no streaming deltas were received
            // (prevents duplication when stream-json emits both deltas and summary)
            if (!this.receivedText) {
              this.receivedText = true;
              this.emit('event', { ...event, type: 'text_delta' });
            }
          } else {
            this.emit('event', event);
          }
        }
      } catch {
        if (trimmed.length > 0 && !this.isNoiseLine(trimmed)) {
          // Only treat non-JSON lines as text if we've already received
          // structured text from the CLI (avoids polluting with startup noise).
          if (this.receivedText) {
            this.emit('event', {
              type: 'text_delta',
              data: { text: trimmed },
              raw: trimmed,
            } satisfies NdjsonEvent);
          } else {
            this.emit('event', {
              type: 'progress',
              data: { type: 'raw_output', message: trimmed },
              raw: trimmed,
            } satisfies NdjsonEvent);
          }
        }
      }
    }
  }

  private isNoiseLine(line: string): boolean {
    return /^\[[\w-]+\]\s/.test(line) ||
      /plugin\s+load/i.test(line) ||
      /^(debug|info|warn(ing)?|trace)[\s:]/i.test(line);
  }
}

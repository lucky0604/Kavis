import type { ServerResponse } from 'http';
import type { NdjsonEvent } from './subprocess-types';

/**
 * Wraps an HTTP ServerResponse for SSE (Server-Sent Events) streaming.
 * Handles header setup, JSON event serialization, text debouncing,
 * and final done/end signaling.
 */
export class SSEWriter {
  private res: ServerResponse;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingText = '';

  constructor(res: ServerResponse, streamKey: string, workspace: string) {
    this.res = res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Stream-Id': streamKey,
      'X-Workspace': workspace,
    });
  }

  /**
   * Write a stream event to the SSE connection.
   * text_delta events are debounced (50ms); all others are written immediately.
   */
  writeEvent(event: NdjsonEvent): void {
    if (event.type === 'text_delta') {
      const text = (event.data as { text?: string })?.text ?? '';
      this.pendingText += text;
      if (!this.debounceTimer) {
        this.debounceTimer = setTimeout(() => this.flushPending(), 50);
      }
    } else {
      this.flushPending();
      this.writeRaw(JSON.stringify({ type: event.type, data: event.data }));
    }
  }

  /** Flush any accumulated text delta to the SSE stream. */
  flushPending(): void {
    if (this.pendingText) {
      this.writeRaw(JSON.stringify({ type: 'text_delta', data: { text: this.pendingText } }));
      this.pendingText = '';
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Write a done event and close the connection. */
  writeDone(code: number | null): void {
    this.flushPending();
    this.writeRaw(JSON.stringify({ type: 'done', data: { code } }));
    this.res.end();
  }

  /** Write a raw SSE data line. */
  writeRaw(data: string): void {
    this.res.write(`data: ${data}\n\n`);
  }

  /** End the SSE response without writing a done event. */
  end(): void {
    this.flushPending();
    this.res.end();
  }

  /** Cancel the debounce timer (call on req close). */
  cancelDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

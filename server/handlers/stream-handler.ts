import type { IncomingMessage, ServerResponse } from 'http';
import type { Message } from '../../shared/types';
import { handleChatStream } from '../routes/chat';
import { readBody } from '../shared/utils/read-body';
import { logError } from '../shared/utils/error-log';

export async function handleStreamRequest(req: IncomingMessage, res: ServerResponse) {
  const apiKey = (req.headers['x-api-key'] as string) || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_api_key' }));
    return;
  }

  const body = await readBody(req);
  const messages = (body.messages as Message[]) || [];
  if (!Array.isArray(messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array required' }));
    return;
  }

  const workspacePath = (body.workspacePath as string) || '';
  const sessionId = (body.sessionId as string) || crypto.randomUUID();
  const baseUrl = (typeof body.baseUrl === 'string' && body.baseUrl.trim()) || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const modelName = (typeof body.modelName === 'string' && body.modelName.trim()) || process.env.OPENAI_MODEL || 'gpt-4o';
  // New: accept mode+role from frontend, fall back to legacy agentId
  const mode = body.mode as string | undefined;
  const role = body.role as string | undefined;
  const agentId = (body.agentId as string) || undefined;

  const abortController = new AbortController();
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    abortController.abort();
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.on('error', (err) => {
    clientClosed = true;
    console.error('[prod-sse] response stream error:', {
      message: err.message,
      code: (err as NodeJS.ErrnoException).code,
      name: err.name,
    });
    logError({
      source: 'prod-sse-socket',
      message: err.message,
      kind: 'unknown',
      code: (err as NodeJS.ErrnoException).code,
      extra: { errorName: err.name },
    });
  });

  /**
   * SSE comment-line heartbeat. Sent every 15s while streaming so any intermediary
   * (nginx idle_timeout default 60s, corporate proxies, mobile NAT) keeps the
   * connection alive even during long tool-loop gaps when no data flows.
   * Lines starting with ':' are SSE comments — browsers/EventSource silently ignore them.
   */
  const heartbeat = setInterval(() => {
    if (clientClosed) return;
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clientClosed = true;
      console.error('[prod-sse] heartbeat write failed:', err instanceof Error ? err.message : err);
    }
  }, 15_000);

  try {
    const stream = await handleChatStream(
      {
        messages: messages as Message[],
        workspacePath, sessionId, apiKey, baseUrl, modelName,
        mode: mode as any,
        role: role as any,
        agentId,
      },
      abortController.signal
    );

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientClosed) break;
      res.write(value);
    }
  } catch (err) {
    const encoder = new TextEncoder();
    const message = err instanceof Error ? err.message : 'Stream error';
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    const name = err instanceof Error ? err.name : undefined;
    const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : undefined;
    console.error('[prod-sse] handler error:', { message, code, name });
    logError({ source: 'prod-sse', message, kind: 'unknown', code, stack, extra: { errorName: name } });
    if (!clientClosed) {
      try {
        res.write(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', data: { message, kind: 'unknown', code } })}\n\n`
          )
        );
      } catch {
        // socket already closed — nothing to flush
      }
    }
  } finally {
    clearInterval(heartbeat);
    if (!clientClosed) {
      try {
        res.write('data: [DONE]\n\n');
      } catch {
        // socket already closed
      }
    }
    try { res.end(); } catch { /* already ended */ }
  }
}

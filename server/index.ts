import type { ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Message } from '../shared/types';
import { handleChatStream, handleGetMessages } from './routes/chat';

// Register all tools (side-effect imports)
import './tools/read-file';
import './tools/list-dir-tree';
import './tools/search-content';
import './tools/write-file';
import './tools/shell-exec';
import './tools/git-ops';

export function configureApiRoutes(server: ViteDevServer) {
  server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      if (req.method === 'POST' && pathname === '/chat/stream') {
        await handleStreamRequest(req, res);
      } else if (req.method === 'GET' && pathname === '/chat/messages') {
        await handleMessagesRequest(req, res);
      } else if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

async function handleStreamRequest(req: IncomingMessage, res: ServerResponse) {
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

  // Set up AbortController linked to client disconnect
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const stream = await handleChatStream(
      { messages: messages as Message[], workspacePath, sessionId, apiKey, baseUrl, modelName },
      abortController.signal
    );

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    const encoder = new TextEncoder();
    res.write(
      encoder.encode(
        `data: ${JSON.stringify({ type: 'error', data: { message: err instanceof Error ? err.message : 'Stream error' } })}\n\n`
      )
    );
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function handleMessagesRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId') || 'default';

  const result = await handleGetMessages(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const MAX_BODY = 1024 * 1024; // 1MB
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        resolve({ error: 'Request body too large' });
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

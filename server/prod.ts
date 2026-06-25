import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Message } from '../shared/types';
import { handleChatStream, handleGetMessages } from './routes/chat';
import { resolveToolApproval } from './engine/tool-approval';
import { handleProjects } from './routes/projects';
import { handleSessionRoutes } from './routes/sessions';
import { agentRegistry } from './agents/registry';
import { OPERATING_MODES, AGENT_ROLES, promptFileKey, compositeId, compositeName } from './agents/config';
import Database from 'better-sqlite3';

import { handleCodeModeRoutes } from './code-mode/handoff-routes';
import { handleStreamRoutes } from './code-mode/stream-routes';
import { handleOnboardingRoutes } from './code-mode/onboarding-routes';
import { readBody } from './utils/read-body';

// Register all tools (side-effect imports)
import './tools/read-file';
import './tools/list-dir-tree';
import './tools/search-content';
import './tools/write-file';
import './tools/shell-exec';
import './tools/git-ops';
import './tools/web-search';
import './tools/web-fetch';
import './tools/evolve';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function registerAgentWithDir(
  promptsDir: string,
  id: string,
  name: string,
  description: string,
  promptFileName: string,
  tools: string[],
  capCategories: string[],
  iconKey: string,
): void {
  if (agentRegistry.get(id)) return;
  const promptPath = path.join(promptsDir, `${promptFileName}.md`);
  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  } catch {
    console.warn(`[Janus] Prompt file not found: ${promptPath}`);
  }
  agentRegistry.register({
    id, name, description, systemPrompt,
    tools,
    capabilities: capCategories.map((c) => ({ category: c as any, level: 4 })),
    iconKey,
    status: 'active',
  });
}

function registerAllAgents(promptsDir: string): void {
  const register = (
    id: string, name: string, description: string,
    promptFileName: string, tools: string[], capCategories: string[], iconKey: string,
  ) => registerAgentWithDir(promptsDir, id, name, description, promptFileName, tools, capCategories, iconKey);

  for (const mode of OPERATING_MODES) {
    if (mode.id === 'work') {
      register('work', mode.name, mode.description,
        promptFileKey('work'), mode.tools,
        mode.capabilities.map((c) => c.category), mode.iconKey);
    }
  }

  for (const mode of OPERATING_MODES) {
    if (mode.id !== 'code') continue;
    for (const role of AGENT_ROLES) {
      register(compositeId(mode.id, role.id),
        compositeName(mode.name, role.name), role.description,
        promptFileKey(mode.id, role.id), mode.tools,
        mode.capabilities.map((c) => c.category), mode.iconKey);
    }
  }
}

/**
 * Handle GET /api/agents — return modes + roles for the frontend.
 */
function handleAgentsList(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const modes = OPERATING_MODES.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    capabilities: m.capabilities.map((c) => c.category),
    iconKey: m.iconKey,
  }));
  const roles = AGENT_ROLES.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ modes, roles }));
  return Promise.resolve();
}

// ---- Shared API route handler (used by both prod server and Vite dev) ----

function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return Promise.resolve();
  }

  if (req.method === 'POST' && pathname === '/chat/stream') {
    return handleStreamRequest(req, res);
  }

  if (req.method === 'POST' && pathname === '/chat/approval') {
    return handleApprovalRequest(req, res);
  }

  if (req.method === 'GET' && pathname === '/chat/messages') {
    return handleMessagesRequest(req, res);
  }

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return Promise.resolve();
  }

  if (req.method === 'GET' && pathname === '/memory/status') {
    return handleMemoryStatus(req, res);
  }

  if (req.method === 'GET' && pathname === '/agents') {
    return handleAgentsList(req, res);
  }

  // Session management
  if (pathname.startsWith('/sessions')) {
    return handleSessionRoutes(req, res);
  }

  if (pathname.startsWith('/projects')) {
    return handleProjects(req, res);
  }

  if (pathname.startsWith('/code-mode/') || pathname.startsWith('/onboarding/')) {
    const rawWorkspace = url.searchParams.get('workspace')
      || process.env.JANUS_WORKSPACE
      || '';
    const codeModeWorkspace = rawWorkspace ? path.resolve(rawWorkspace) : process.cwd();
    const fullPath = '/api' + pathname;
    const handled =
      handleCodeModeRoutes(req, res, fullPath, codeModeWorkspace) ||
      handleStreamRoutes(req, res, fullPath, codeModeWorkspace) ||
      handleOnboardingRoutes(req, res, fullPath, codeModeWorkspace);
    if (handled) return Promise.resolve();
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
  return Promise.resolve();
}

// ---- Stream handler ----

function handleMemoryStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const homeDir = os.homedir();
    const memoryDir = path.join(homeDir, '.janus');
    const dbPath = path.join(memoryDir, 'memory.db');
    const memoryMdPath = path.join(memoryDir, 'MEMORY.md');

    const dbExists = fs.existsSync(dbPath);
    const mdExists = fs.existsSync(memoryMdPath);

    let memoryCount = 0;
    let preferenceCount = 0;
    let recentMemories: Array<{ id: number; content: string; category: string; source: string }> = [];

    if (dbExists) {
      let db: Database.Database | undefined;
      try {
        db = new Database(dbPath, { readonly: true });

        memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memory_index').get() as { c: number }).c;
        preferenceCount = (db.prepare('SELECT COUNT(*) as c FROM preferences').get() as { c: number }).c;

        recentMemories = (db.prepare(
          'SELECT rowid as id, content, category, source FROM memory_index ORDER BY rowid DESC LIMIT 10'
        ).all() as Array<{ id: number; content: string; category: string; source: string }>);
      } catch (err) {
        console.error('[Janus memory] memory/status DB read failed:', err instanceof Error ? err.message : err);
      } finally {
        db?.close();
      }
    }

    const mdContent = mdExists ? fs.readFileSync(memoryMdPath, 'utf-8') : null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      memoryDir,
      dbExists,
      mdExists,
      memoryCount,
      preferenceCount,
      dbSize: dbExists ? fs.statSync(dbPath).size : 0,
      mdSize: mdExists ? fs.statSync(memoryMdPath).size : 0,
      recentMemories,
      mdPreview: mdContent ? mdContent.slice(0, 500) : null,
    }, null, 2));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Memory status failed' }));
  }
  return Promise.resolve();
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
  });

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
    console.error('[prod-sse] handler error:', { message, code, name });
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

async function handleApprovalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
  const approved = body.approved === true;

  if (!approvalId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'approvalId required' }));
    return;
  }

  const ok = resolveToolApproval(approvalId, approved);
  if (!ok) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Approval not found or already resolved' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

async function handleMessagesRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId') || 'default';

  const result = await handleGetMessages(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

// ---- Server factory: used by both standalone prod and Electron ----

export interface JanusServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export function createJanusServer(distDir?: string, port?: number, promptsDir?: string): Promise<JanusServer> {
  const DIST = distDir || path.resolve(__dirname, '..', 'dist');
  const PROMPTS = promptsDir || path.join(__dirname, 'agents', 'prompts');

  registerAllAgents(PROMPTS);

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // API routes take priority
    if (url.pathname.startsWith('/api/')) {
      req.url = url.pathname.slice('/api'.length) + url.search;
      handleApiRequest(req, res).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
      return;
    }

    // Static file serving
    let filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);

    server.listen(port || 0, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : (port || 3000);
      console.log(`[Janus] Server running on http://localhost:${actualPort}`);

      resolve({
        server,
        port: actualPort,
        close: () => new Promise((res, rej) => server.close((err) => err ? rej(err) : res())),
      });
    });
  });
}

// ---- Vite dev server integration ----

export function configureApiRoutes(viteServer: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
  registerAllAgents(path.join(__dirname, 'agents', 'prompts'));
  viteServer.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse) => {
    handleApiRequest(req, res).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });
}

// ---- Direct execution entrypoint ----
const isDirectRun = (() => {
  try {
    const thisModulePath = fileURLToPath(import.meta.url);
    return process.argv[1] && path.resolve(process.argv[1]) === thisModulePath;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const port = parseInt(process.env.PORT || '3000', 10);
  createJanusServer(undefined, port).catch((err) => {
    console.error('[Janus] Failed to start standalone server:', err);
    process.exit(1);
  });
}
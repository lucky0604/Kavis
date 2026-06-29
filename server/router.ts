import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { handleStreamRequest } from './handlers/stream-handler';
import { handleProviderHealth } from './handlers/health-handler';
import { handleApprovalRequest } from './handlers/approval-handler';
import { handleMessagesRequest } from './handlers/messages-handler';
import { handleMemoryStatus } from './handlers/memory-handler';
import { handleAgentsList } from './handlers/agents-handler';
import { handleSkillsList, handleSkillDetail } from './handlers/skills-handler';
import { handleSessionRoutes } from './routes/sessions';
import { handleProjects } from './routes/projects';
import { handleCodeModeRoutes } from './code-mode/external/handoff-routes';
import { handleStreamRoutes } from './code-mode/external/stream-routes';
import { handleOnboardingRoutes } from './code-mode/external/onboarding-routes';

export function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  if (req.method === 'POST' && pathname === '/health/provider') {
    return handleProviderHealth(req, res);
  }

  if (req.method === 'GET' && pathname === '/memory/status') {
    return handleMemoryStatus(req, res);
  }

  if (req.method === 'GET' && pathname === '/agents') {
    return handleAgentsList(req, res);
  }

  if (req.method === 'GET' && pathname === '/skills') {
    return handleSkillsList(req, res);
  }

  if (req.method === 'GET' && pathname.startsWith('/skills/')) {
    let name: string;
    try {
      name = decodeURIComponent(pathname.slice('/skills/'.length));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed skill name' }));
      return Promise.resolve();
    }
    if (name) {
      return handleSkillDetail(req, res, name);
    }
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
      || process.env.KAVIS_WORKSPACE
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

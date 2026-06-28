import type { IncomingMessage, ServerResponse } from 'http';
import * as projectRepo from '../shared/persistence/project-repository';

export async function handleProjects(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method;
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/projects') {
      await handleListProjects(res);
    } else if (method === 'POST' && pathname === '/projects') {
      await handleAddProject(req, res);
    } else if (method === 'DELETE' && pathname.startsWith('/projects/')) {
      const projectId = pathname.split('/').pop() || '';
      await handleDeleteProject(projectId, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

async function handleListProjects(res: ServerResponse): Promise<void> {
  const projects = await projectRepo.loadProjects();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ projects }));
}

async function handleAddProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const { path: projectPath } = JSON.parse(body);

  if (!projectPath || typeof projectPath !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid path' }));
    return;
  }

  const project = await projectRepo.addProject(projectPath);

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ project }));
}

async function handleDeleteProject(projectId: string, res: ServerResponse): Promise<void> {
  if (!projectId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing project ID' }));
    return;
  }

  await projectRepo.removeProject(projectId);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

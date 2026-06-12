import type { IncomingMessage, ServerResponse } from 'http';
import { readHandoff, writeHandoff, deleteHandoff, createHandoffContext, ensureGitignore } from './handoff-helper';
import { stashActiveChanges, applyStashedChanges } from './git-syncer';
import { detectAllClis } from './cli-registry';
import type { CliToolId, HandoffTodo } from '../../shared/types';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export function handleCodeModeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  workspacePath: string,
): boolean {
  if (urlPath === '/api/code-mode/detect' && req.method === 'GET') {
    json(res, 200, { clis: detectAllClis() });
    return true;
  }

  if (urlPath === '/api/code-mode/handoff/status' && req.method === 'GET') {
    const handoff = readHandoff(workspacePath);
    json(res, 200, { active: handoff !== null, handoff });
    return true;
  }

  if (urlPath === '/api/code-mode/handoff/initiate' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const { previousCli, nextCli, todos } = JSON.parse(body) as {
          previousCli: CliToolId;
          nextCli: CliToolId;
          todos?: string[];
        };

        ensureGitignore(workspacePath);

        const todoItems: HandoffTodo[] = (todos ?? []).map((t) => ({
          text: t,
          completed: false,
        }));

        // Phase 1: Write handoff metadata BEFORE destructive git ops
        const ctx = createHandoffContext({
          sessionId: `relay-${Date.now()}`,
          projectPath: workspacePath,
          previousCli,
          nextCli,
          todos: todoItems,
          stashHash: null,
          commitSha: '',
        });
        writeHandoff(workspacePath, ctx);

        // Phase 2: Execute git stash + hard reset
        const stashResult = stashActiveChanges(workspacePath);
        ctx.stashHash = stashResult.stashHash;
        ctx.commitSha = stashResult.commitSha;
        ctx.timestamp = new Date().toISOString();
        writeHandoff(workspacePath, ctx);

        json(res, 200, { success: true, handoff: ctx });
      } catch (err) {
        json(res, 500, { success: false, error: String(err) });
      }
    }).catch(() => json(res, 400, { error: 'Invalid request body' }));
    return true;
  }

  if (urlPath === '/api/code-mode/handoff/complete' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const handoff = readHandoff(workspacePath);
        if (!handoff) {
          json(res, 404, { success: false, error: 'No active handoff' });
          return;
        }

        const updates = JSON.parse(body) as { todos?: HandoffTodo[] };
        if (updates.todos) handoff.todos = updates.todos;

        if (handoff.stashHash) {
          const result = applyStashedChanges(
            workspacePath,
            handoff.stashHash,
            handoff.commitSha,
          );
          if (!result.success) {
            json(res, 409, {
              success: false,
              error: result.error,
              conflictFiles: result.conflictFiles,
            });
            return;
          }
        }

        // Clear handoff state after successful completion
        deleteHandoff(workspacePath);
        json(res, 200, { success: true });
      } catch (err) {
        json(res, 500, { success: false, error: String(err) });
      }
    }).catch(() => json(res, 400, { error: 'Invalid request body' }));
    return true;
  }

  return false;
}

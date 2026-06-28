import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { SubprocessRunner, type NdjsonEvent } from './subprocess-runner';
import { getCliConfig, checkModelCompatibility } from './cli-registry';
import { saveCliSession, markTurnCompleted, markTurnDirty } from './cli-session-tracker';
import { assembleHandoffContext, writeWorkspaceContextFile } from './context-assembler';
import { determineResumeMode, buildCliArgs, type CliInvocationContext } from './stream-format';
import { SSEWriter } from './stream-sse';
import type { CliToolId } from '../../../shared/types';

// Re-export public types so existing consumers don't break
export type { ResumeMode, CliInvocationContext } from './stream-format';

const activeRunners = new Map<string, SubprocessRunner>();

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export function handleStreamRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  workspacePath: string,
): boolean {
  if (urlPath === '/api/code-mode/stream' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const { cliId, prompt, model, workspacePath: bodyWorkspace, sessionId, previousCli } = JSON.parse(body) as {
          cliId: CliToolId;
          prompt: string;
          model?: string;
          workspacePath?: string;
          sessionId?: string;
          previousCli?: CliToolId;
        };

        const effectiveWorkspace = (bodyWorkspace || workspacePath || '').trim();
        if (!effectiveWorkspace) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'workspace path required — select a project first' }));
          return;
        }

        const resolvedWorkspace = path.resolve(effectiveWorkspace);

        if (!fs.existsSync(resolvedWorkspace) || !fs.statSync(resolvedWorkspace).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid workspace directory: ${resolvedWorkspace}` }));
          return;
        }

        const config = getCliConfig(cliId);
        if (!config) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown CLI: ${cliId}` }));
          return;
        }

        // Compatibility check: warn if the CLI+model combo is known-incompatible
        if (model) {
          const compat = checkModelCompatibility(cliId, model);
          if (!compat.compatible) {
            const sse = new SSEWriter(res, 'compat-check', resolvedWorkspace);
            sse.writeRaw(JSON.stringify({
              type: 'error',
              data: { message: `${compat.warning}\n\nSuggestion: ${compat.suggestion}` },
            }));
            sse.writeDone(1);
            return;
          }
        }

        const { mode: resumeMode, nativeSessionId } = determineResumeMode(sessionId, cliId, previousCli);

        // Assemble handoff context when switching CLIs
        let handoffPrefix: string | undefined;
        if (resumeMode === 'handoff' && sessionId) {
          const context = assembleHandoffContext(sessionId, cliId);
          if (context) {
            handoffPrefix = context.prefix;
            // Write workspace context file for CLIs that read project files
            try { writeWorkspaceContextFile(resolvedWorkspace, context); } catch { /* non-fatal */ }
          }
        }

        const ctx: CliInvocationContext = {
          cliId,
          prompt,
          model,
          workspacePath: resolvedWorkspace,
          resumeMode,
          nativeSessionId,
          handoffPrefix,
        };
        const args = buildCliArgs(ctx);
        const runner = new SubprocessRunner();
        const sessionKey = `stream-${Date.now()}`;

        // Clean up any existing runner for the same session to avoid orphans
        for (const [key, existingRunner] of activeRunners) {
          if (key.endsWith(`:${sessionId}`)) {
            existingRunner.kill();
            activeRunners.delete(key);
          }
        }
        const uniqueKey = `${sessionKey}:${sessionId}`;
        activeRunners.set(uniqueKey, runner);
        activeRunners.set(sessionKey, runner);

        const sse = new SSEWriter(res, sessionKey, resolvedWorkspace);

        let sessionMetaCaptured = false;

        runner.on('event', (event: NdjsonEvent) => {
          if (event.type === 'session_meta') {
            // Capture CLI native session ID (once per invocation)
            if (!sessionMetaCaptured && sessionId) {
              const meta = event.data as { cliSessionId?: string } | undefined;
              if (meta?.cliSessionId) {
                saveCliSession(sessionId, cliId, meta.cliSessionId);
                sessionMetaCaptured = true;
              }
            }
          }
          sse.writeEvent(event);
        });

        let resumeFallbackAttempted = false;

        runner.on('exit', (code: number) => {
          sse.flushPending();

          // Resume failed → fallback to fresh mode (only one retry)
          if (code !== 0 && resumeMode === 'resume' && !resumeFallbackAttempted) {
            resumeFallbackAttempted = true;
            sse.writeRaw(JSON.stringify({
              type: 'progress',
              data: { type: 'system', message: 'Resume failed, retrying in fresh mode...' },
            }));

            const freshCtx: CliInvocationContext = { ...ctx, resumeMode: 'fresh', nativeSessionId: undefined };
            const freshArgs = buildCliArgs(freshCtx);
            const freshRunner = new SubprocessRunner();
            activeRunners.set(uniqueKey, freshRunner);
            activeRunners.set(sessionKey, freshRunner);

            freshRunner.on('event', (event: NdjsonEvent) => {
              if (event.type === 'session_meta') {
                if (!sessionMetaCaptured && sessionId) {
                  const meta = event.data as { cliSessionId?: string } | undefined;
                  if (meta?.cliSessionId) {
                    saveCliSession(sessionId, cliId, meta.cliSessionId);
                    sessionMetaCaptured = true;
                  }
                }
              }
              sse.writeEvent(event);
            });
            freshRunner.on('exit', (freshCode: number) => {
              sse.flushPending();
              if (sessionId && freshCode === 0) markTurnCompleted(sessionId, cliId);
              sse.writeDone(freshCode);
              activeRunners.delete(uniqueKey);
              activeRunners.delete(sessionKey);
            });
            freshRunner.start(config.binaryName, freshArgs, resolvedWorkspace);
            return;
          }

          // Mark turn completed on clean exit
          if (sessionId && code === 0) {
            markTurnCompleted(sessionId, cliId);
          }
          sse.writeDone(code);
          activeRunners.delete(uniqueKey);
          activeRunners.delete(sessionKey);
        });

        req.on('close', () => {
          sse.cancelDebounce();
          // Mark session dirty on abort (unsafe to resume)
          if (sessionId) {
            markTurnDirty(sessionId, cliId);
          }
          runner.kill();
          activeRunners.delete(uniqueKey);
          activeRunners.delete(sessionKey);
        });

        // Always record CLI usage so getLastUsedCli works even if session_meta never arrives
        if (sessionId) {
          saveCliSession(sessionId, cliId, `__janus_${Date.now()}`);
        }

        runner.start(config.binaryName, args, resolvedWorkspace);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }).catch(() => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    });
    return true;
  }

  if (urlPath === '/api/code-mode/stream/cancel' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const { streamId } = JSON.parse(body) as { streamId: string };
        const runner = activeRunners.get(streamId);
        if (runner) {
          runner.kill();
          activeRunners.delete(streamId);
          // Also clean up any session-specific entry keyed by streamId:sessionId
          for (const key of activeRunners.keys()) {
            if (key.startsWith(streamId + ':')) activeRunners.delete(key);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    }).catch(() => {
      res.writeHead(400);
      res.end();
    });
    return true;
  }

  return false;
}

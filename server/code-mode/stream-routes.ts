import type { IncomingMessage, ServerResponse } from 'http';
import { SubprocessRunner, type NdjsonEvent } from './subprocess-runner';
import { getCliConfig } from './cli-registry';
import type { CliToolId } from '../../shared/types';

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
        const { cliId, prompt, model } = JSON.parse(body) as {
          cliId: CliToolId;
          prompt: string;
          model?: string;
        };

        const config = getCliConfig(cliId);
        if (!config) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown CLI: ${cliId}` }));
          return;
        }

        const args = buildCliArgs(cliId, prompt, model);
        const runner = new SubprocessRunner();
        const sessionKey = `stream-${Date.now()}`;
        activeRunners.set(sessionKey, runner);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Stream-Id': sessionKey,
        });

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingText = '';

        const flushText = () => {
          if (pendingText) {
            const payload = JSON.stringify({ type: 'text_delta', data: { text: pendingText } });
            res.write(`data: ${payload}\n\n`);
            pendingText = '';
          }
          debounceTimer = null;
        };

        runner.on('event', (event: NdjsonEvent) => {
          if (event.type === 'text_delta') {
            const text = (event.data as { text?: string })?.text ?? '';
            pendingText += text;
            if (!debounceTimer) {
              debounceTimer = setTimeout(flushText, 50);
            }
          } else {
            if (pendingText) flushText();
            const payload = JSON.stringify({ type: event.type, data: event.data });
            res.write(`data: ${payload}\n\n`);
          }
        });

        runner.on('exit', (code: number) => {
          if (pendingText) flushText();
          const done = JSON.stringify({ type: 'done', data: { code } });
          res.write(`data: ${done}\n\n`);
          res.end();
          activeRunners.delete(sessionKey);
        });

        req.on('close', () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          runner.kill();
          activeRunners.delete(sessionKey);
        });

        runner.start(config.binaryName, args, workspacePath);
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

function buildCliArgs(cliId: CliToolId, prompt: string, model?: string): string[] {
  switch (cliId) {
    case 'claudecode':
      return [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        ...(model ? ['--model', model] : []),
      ];
    case 'codex':
      return [
        'exec', prompt,
        '--json',
        ...(model ? ['--model', model] : []),
      ];
    case 'opencode':
      return [
        'run', prompt,
        '--format', 'json',
        '--pure',
        ...(model ? ['--model', model] : []),
      ];
    default:
      return [prompt];
  }
}

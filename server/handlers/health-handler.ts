import type { IncomingMessage, ServerResponse } from 'http';
import { probeProvider } from '../shared/ai/health-check';
import { readBody } from '../shared/utils/read-body';
import { logError } from '../shared/utils/error-log';

export async function handleProviderHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = (req.headers['x-api-key'] as string) || '';
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'API key required' }));
    return;
  }
  const body = await readBody(req);
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : undefined;
  const modelName = typeof body.modelName === 'string' && body.modelName ? body.modelName : 'gpt-4o';

  const result = await probeProvider(apiKey, baseUrl, modelName);
  if (!result.ok) {
    logError({
      source: 'health-probe',
      message: result.message || 'probe failed',
      kind: 'upstream',
      status: result.status,
      baseUrl: result.baseUrl,
      model: result.model,
      code: result.code,
      extra: { latencyMs: result.latencyMs },
    });
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

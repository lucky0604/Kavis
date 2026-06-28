import { sanitizeBaseUrl } from './openai-adapter';
import { upstreamFetch } from './upstream-fetch';

export interface HealthCheckResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  baseUrl?: string;
  model: string;
  message?: string;
  code?: string;
}

export async function probeProvider(
  apiKey: string,
  baseUrl: string | undefined,
  modelName: string,
): Promise<HealthCheckResult> {
  const start = Date.now();
  const sanitizedBase = sanitizeBaseUrl(baseUrl);
  const effectiveBase = (baseUrl?.trim() || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${effectiveBase}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await upstreamFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { ok: true, status: res.status, latencyMs, baseUrl: sanitizedBase, model: modelName };
    }

    let bodyMsg = '';
    try {
      const body = await res.json() as { error?: { message?: string } };
      bodyMsg = body?.error?.message || '';
    } catch {
      // body not JSON — leave bodyMsg empty
    }

    return {
      ok: false,
      status: res.status,
      latencyMs,
      baseUrl: sanitizedBase,
      model: modelName,
      message: bodyMsg || `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      ok: false,
      latencyMs,
      baseUrl: sanitizedBase,
      model: modelName,
      message: isAbort ? 'Probe timeout after 5s' : (err instanceof Error ? err.message : 'Probe failed'),
      code: err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

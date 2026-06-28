/**
 * Shared upstream fetch for ALL LLM provider traffic in Kavis
 * (streaming chat, title generation, health probes, any future provider tool).
 *
 * Why this exists
 * ---------------
 * Different corporate AI gateways have different transport quirks:
 *   - thor (ipsapro.isoftstone.com): REQUIRES HTTP/2. h1 keep-alive sockets are
 *     RST ~1s after handshake → ERR_STREAM_PREMATURE_CLOSE chunks=0 bytes=0.
 *   - OpenAI / DeepSeek / Qwen / Anthropic compat / vLLM / Ollama: work on both
 *     h1 and h2; some local deployments are h1-only.
 *
 * undici's `allowH2: true` performs ALPN negotiation per-connection: if the
 * server advertises h2 it uses h2, otherwise it transparently falls back to h1.
 * One dispatcher therefore works for every provider — swapping providers in
 * Settings never requires a code change here.
 *
 * Headers
 * -------
 * Some gateways (thor again) fingerprint the User-Agent and sever the TCP
 * connection mid-stream if it detects a non-browser client (the OpenAI SDK's
 * default `OpenAI/JS x.y.z` is one such tell). BROWSER_HEADERS masks this for
 * everyone — harmless to providers that don't care.
 */
import { Agent as UndiciAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { BROWSER_HEADERS } from './headers';

let sharedDispatcher: UndiciAgent | undefined;

export function getUpstreamDispatcher(): UndiciAgent {
  if (!sharedDispatcher) {
    sharedDispatcher = new UndiciAgent({
      // ALPN-negotiated: prefers h2, transparently falls back to h1 per server.
      allowH2: true,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 600_000,
      connect: { timeout: 60_000 },
    });
  }
  return sharedDispatcher;
}

/**
 * Drop-in fetch replacement for OpenAI SDK / generic provider calls.
 * Always uses the shared h2-capable dispatcher and merges BROWSER_HEADERS as defaults
 * (caller-supplied headers win on key conflict).
 */
export const upstreamFetch = ((url: any, init?: any) => {
  const mergedHeaders = mergeHeaders(BROWSER_HEADERS, init?.headers);
  const finalInit: UndiciRequestInit = {
    ...(init as UndiciRequestInit),
    headers: mergedHeaders,
    dispatcher: getUpstreamDispatcher(),
  };
  return undiciFetch(url, finalInit);
}) as unknown as typeof fetch;

/**
 * Header merging that handles both plain object and Headers instances.
 * Caller-supplied values override defaults — important so Authorization /
 * Content-Type / X-API-Key set by the SDK or call site take precedence over
 * BROWSER_HEADERS' generic Accept.
 */
function mergeHeaders(defaults: Record<string, string>, override: any): Record<string, string> {
  const out: Record<string, string> = { ...defaults };
  if (!override) return out;
  if (override instanceof Headers || (typeof override?.forEach === 'function' && !Array.isArray(override))) {
    (override as Headers).forEach?.((v: string, k: string) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(override)) {
    for (const [k, v] of override) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(override)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

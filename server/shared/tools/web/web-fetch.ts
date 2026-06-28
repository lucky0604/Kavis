import http from 'http';
import https from 'https';
import dns from 'dns';
import { URL } from 'url';
import { toolRegistry } from '../registry';
import { validateUrlForFetch, validateRedirectChain, isPrivateIP } from './url-validator';
import { extractContent } from './content-extractor';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB raw response
const MAX_REDIRECTS = 3;

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  redirectChain: string[];
}

const dnsLookup = dns.lookup;

/**
 * HTTP GET with timeout, size limits, and redirect tracking.
 * Each redirect URL is validated for SSRF.
 */
export async function fetchWithLimits(
  url: string,
  timeout = FETCH_TIMEOUT_MS,
  maxRedirects = MAX_REDIRECTS,
  externalSignal?: AbortSignal
): Promise<FetchResult> {
  const redirectChain: string[] = [url];
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const result = await singleFetch(currentUrl, timeout, externalSignal);

    const location = result.headers['location'];
    if (result.status >= 300 && result.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).href;
      redirectChain.push(currentUrl);

      const redirectValidation = await validateRedirectChain([currentUrl]);
      if (!redirectValidation.allowed) {
        throw new Error(`Redirect blocked: ${redirectValidation.reason}`);
      }
      continue;
    }

    return { ...result, finalUrl: currentUrl, redirectChain };
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

/**
 * Single HTTP GET request with timeout, size limits, and SSRF-safe DNS.
 */
function singleFetch(url: string, timeout: number, externalSignal?: AbortSignal): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Fetch timed out after ${timeout}ms`));
    }, timeout);

    if (externalSignal) {
      externalSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Kavis/0.1.0',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      signal: controller.signal,
      lookup: (hostname, opts, callback) => {
        dnsLookup(hostname, opts, (err, address, family) => {
          if (err) {
            callback(err, address, family);
            return;
          }
          // SSRF protection: re-check the resolved IP at request time
          // to prevent DNS rebinding / TOCTOU attacks
          if (typeof address === 'string' && isPrivateIP(address)) {
            callback(new Error(`SSRF blocked: ${hostname} resolved to private IP ${address}`), address, family);
            return;
          }
          callback(err, address, family);
        });
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          controller.abort();
          reject(new Error(`Response exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        clearTimeout(timeoutId);
        const body = Buffer.concat(chunks).toString('utf-8');
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') headers[key] = value;
          else if (Array.isArray(value)) headers[key] = value.join(', ');
        }
        resolve({ status: res.statusCode || 200, headers, body, finalUrl: url, redirectChain: [] });
      });

      res.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

// ---- Tool Registration ----

toolRegistry.register({
  name: 'web_fetch',
  description: 'Fetch and extract readable content from a web page URL. Returns the page title and text content.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from (http or https)',
      },
    },
    required: ['url'],
  },
  execute: async (args: Record<string, unknown>) => {
    const url = args.url as string;

    const validation = await validateUrlForFetch(url);
    if (!validation.allowed) {
      return { success: false, error: `Blocked: ${validation.reason}` };
    }

    try {
      const response = await fetchWithLimits(url);

      if (response.status >= 400) {
        return { success: false, error: `HTTP ${response.status}: ${url}` };
      }

      const extracted = await extractContent(response.body, url);

      return {
        success: true,
        data: {
          title: extracted.title,
          textContent: extracted.textContent,
          length: extracted.length,
          url: response.finalUrl,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      if (message.includes('timed out')) {
        return { success: false, error: `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s` };
      }
      if (message.includes('exceeds')) {
        return { success: false, error: message };
      }
      return { success: false, error: `Fetch failed: ${message}` };
    }
  },
});

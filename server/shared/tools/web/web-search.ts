import https from 'https';
import { toolRegistry } from '../registry';
import { parseHTML } from 'linkedom';
import { ProxyAgent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Dispatcher } from 'undici';

const TAVILY_API_URL = 'https://api.tavily.com/search';
const BING_SEARCH_URL = 'https://cn.bing.com/search';
const BAIDU_SEARCH_URL = 'https://www.baidu.com/s';
const BING_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CAP = 20;
const FETCH_TIMEOUT_MS = 15_000;
const SNIPPET_MAX_LENGTH = 500;

interface FetchInit extends RequestInit {
  dispatcher?: Dispatcher;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ─── Proxy support (HTTP_PROXY / HTTPS_PROXY) ──────────────────────────
function getProxyUrl(): string | undefined {
  return process.env.HTTP_PROXY
    || process.env.HTTPS_PROXY
    || process.env.http_proxy
    || process.env.https_proxy;
}

let _proxyDispatcher: ProxyAgent | undefined;
function getProxyDispatcher(): ProxyAgent | undefined {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;
  if (!_proxyDispatcher) {
    _proxyDispatcher = new ProxyAgent(proxyUrl);
  }
  return _proxyDispatcher;
}

let _httpsAgent: HttpsProxyAgent<string> | undefined;
function getHttpsProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;
  if (!_httpsAgent) {
    _httpsAgent = new HttpsProxyAgent(proxyUrl);
  }
  return _httpsAgent;
}

// ─── Tavily API search ────────────────────────────────────────────────
async function tavilySearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('NO_TAVILY_KEY');
  }

  const fetchOpts: FetchInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    fetchOpts.dispatcher = dispatcher;
  }
  const res = await fetch(TAVILY_API_URL, fetchOpts);

  if (!res.ok) {
    // Sanitize error — don't expose response body which may contain API details
    throw new Error(`Tavily API error (HTTP ${res.status})`);
  }

  const data = await res.json() as {
    results?: Array<{ title: string; url: string; content: string; score?: number }>;
  };

  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: (r.content || '').slice(0, SNIPPET_MAX_LENGTH),
  }));

  return { results, engine: 'tavily' };
}

// ─── DuckDuckGo HTML fallback (no API key needed) ─────────────────────
async function duckduckgoSearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const fetchOpts: FetchInit = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KavisBot/1.0)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    fetchOpts.dispatcher = dispatcher;
  }
  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    throw new Error(`DuckDuckGo HTTP ${res.status}`);
  }

  const html = await res.text();

  // Parse DuckDuckGo HTML using DOM parser (linkedom) — robust against HTML variations
  const { document } = parseHTML(html);
  const results: SearchResult[] = [];

  const resultElements = document.querySelectorAll('a.result__a');
  const snippetElements = document.querySelectorAll('a.result__snippet');

  const count = Math.min(resultElements.length, maxResults);
  for (let i = 0; i < count; i++) {
    const anchor = resultElements[i] as HTMLAnchorElement;
    // Get raw href attribute (not the resolved .href property, which may differ across DOM implementations)
    const rawHref = anchor.getAttribute('href') || '';
    let href = rawHref;

    // DuckDuckGo wraps URLs through a redirect — extract the real URL from uddg param
    const uddgMatch = rawHref.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        href = decodeURIComponent(uddgMatch[1]);
      } catch { /* keep original */ }
    } else if (rawHref.startsWith('//') || rawHref.startsWith('/')) {
      // Protocol-relative or path-relative URL — not a real result link
      href = '';
    }

    const title = (anchor.textContent || '').trim();
    const snippet = (snippetElements[i]?.textContent || '').trim().slice(0, SNIPPET_MAX_LENGTH);

    if (href && title) {
      results.push({ title, url: href, snippet });
    }
  }

  return { results, engine: 'duckduckgo' };
}

// ─── Bing HTML fallback (works where DuckDuckGo is blocked, e.g. China) ──
async function bingSearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const encoded = encodeURIComponent(query);
  const url = `${BING_SEARCH_URL}?q=${encoded}&setlang=en-us`;

  const html = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const opts: Record<string, unknown> = {
      headers: {
        'User-Agent': BING_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: FETCH_TIMEOUT_MS,
    };
    const proxyAgent = getHttpsProxyAgent();
    if (proxyAgent) {
      opts.agent = proxyAgent;
    }
    const req = https.get(url, opts, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        settled = true;
        res.resume();
        reject(new Error(`Bing HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        if (!settled) chunks.push(chunk);
      });
      res.on('end', () => {
        if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf-8')); }
      });
      res.on('error', (err) => {
        if (!settled) { settled = true; req.destroy(); reject(err); }
      });
    });
    req.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    req.on('timeout', () => {
      if (!settled) { settled = true; req.destroy(); reject(new Error('Bing request timed out')); }
    });
  });

  const { document } = parseHTML(html);
  const results: SearchResult[] = [];

  const algoElements = document.querySelectorAll('.b_algo');
  for (let i = 0; i < Math.min(algoElements.length, maxResults); i++) {
    const el = algoElements[i];
    const anchor = el.querySelector('h2 a');
    const snippetEl = el.querySelector('.b_caption p, p');

    const title = (anchor?.textContent || '').trim();
    const href = anchor?.getAttribute('href') || '';
    const snippet = (snippetEl?.textContent || '').trim().slice(0, SNIPPET_MAX_LENGTH);

    if (href && title) {
      results.push({ title, url: href, snippet });
    }
  }

  return { results, engine: 'bing' };
}

// ─── Baidu HTML fallback (works where Bing is blocked, e.g. China) ─────
async function baiduSearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const encoded = encodeURIComponent(query);
  const url = `${BAIDU_SEARCH_URL}?wd=${encoded}&rn=${maxResults}`;

  const fetchOpts: FetchInit = {
    headers: {
      'User-Agent': BING_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    fetchOpts.dispatcher = dispatcher;
  }
  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    throw new Error(`Baidu HTTP ${res.status}`);
  }

  const html = await res.text();
  const { document } = parseHTML(html);
  const results: SearchResult[] = [];

  const containers = document.querySelectorAll('div.c-container');
  for (let i = 0; i < Math.min(containers.length, maxResults); i++) {
    const el = containers[i];
    const anchor = el.querySelector('h3 a') || el.querySelector('.c-title a');
    const snippetEl = el.querySelector('.c-abstract')
      || el.querySelector('.content-right_8Zs40')
      || el.querySelector('span.content-right_8Zs40');

    const title = (anchor?.textContent || '').trim();
    const snippet = (snippetEl?.textContent || '').trim().slice(0, SNIPPET_MAX_LENGTH);

    let href = anchor?.getAttribute('href') || '';
    if (href.startsWith('/link?url=') || href.includes('baidu.com/link')) {
      const dataUrl = anchor?.getAttribute('data-url') || anchor?.getAttribute('mu');
      if (dataUrl) {
        href = dataUrl;
      }
    }

    if (href && title) {
      results.push({ title, url: href, snippet });
    }
  }

  return { results, engine: 'baidu' };
}

// Exported for testing
export { tavilySearch, duckduckgoSearch, bingSearch, baiduSearch };

// ─── Tool registration ────────────────────────────────────────────────
toolRegistry.register({
  name: 'web_search',
  description: 'Search the web. Uses Tavily API if TAVILY_API_KEY is set, otherwise falls back to DuckDuckGo, then Bing, then Baidu (free, no key needed). Supports HTTP_PROXY/HTTPS_PROXY env vars for all engines. Returns titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      max_results: {
        type: 'number',
        description: `Maximum number of results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP})`,
      },
    },
    required: ['query'],
  },
  execute: async (args: Record<string, unknown>) => {
    const query = args.query as string;
    const maxResults = Math.min(
      Math.max(1, (args.max_results as number) || DEFAULT_MAX_RESULTS),
      MAX_RESULTS_CAP
    );

    try {
      // Try Tavily first, fall back to DuckDuckGo, then Bing, then Baidu
      let result: { results: SearchResult[]; engine: string };
      try {
        result = await tavilySearch(query, maxResults);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'NO_TAVILY_KEY' || msg.includes('Tavily')) {
          // Fall back to DuckDuckGo, then Bing, then Baidu
          try {
            result = await duckduckgoSearch(query, maxResults);
          } catch (ddgErr) {
            console.warn('DuckDuckGo fallback failed, trying Bing:', ddgErr);
            try {
              result = await bingSearch(query, maxResults);
            } catch (bingErr) {
              console.warn('Bing fallback failed, trying Baidu:', bingErr);
              result = await baiduSearch(query, maxResults);
            }
          }
        } else {
          throw err;
        }
      }

      return {
        success: true,
        data: {
          results: result.results,
          totalCount: result.results.length,
          query,
          engine: result.engine,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      if (message.includes('timed out') || message.includes('abort')) {
        return { success: false, error: 'Search request timed out after 15s' };
      }
      return { success: false, error: `Search failed: ${message}` };
    }
  },
});

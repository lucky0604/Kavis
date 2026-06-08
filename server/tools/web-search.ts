import { toolRegistry } from './registry';
import { parseHTML } from 'linkedom';

const TAVILY_API_URL = 'https://api.tavily.com/search';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CAP = 20;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ─── Tavily API search ────────────────────────────────────────────────
async function tavilySearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('NO_TAVILY_KEY');
  }

  const res = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

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
    snippet: (r.content || '').slice(0, 500),
  }));

  return { results, engine: 'tavily' };
}

// ─── DuckDuckGo HTML fallback (no API key needed) ─────────────────────
async function duckduckgoSearch(query: string, maxResults: number): Promise<{ results: SearchResult[]; engine: string }> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JanusBot/1.0)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15_000),
  });

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
    const snippet = (snippetElements[i]?.textContent || '').trim().slice(0, 500);

    if (href && title) {
      results.push({ title, url: href, snippet });
    }
  }

  return { results, engine: 'duckduckgo' };
}

// Exported for testing
export { tavilySearch, duckduckgoSearch };

// ─── Tool registration ────────────────────────────────────────────────
toolRegistry.register({
  name: 'web_search',
  description: 'Search the web. Uses Tavily API if TAVILY_API_KEY is set, otherwise falls back to DuckDuckGo (free, no key needed). Returns titles, URLs, and snippets.',
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
      // Try Tavily first, fall back to DuckDuckGo
      let result: { results: SearchResult[]; engine: string };
      try {
        result = await tavilySearch(query, maxResults);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'NO_TAVILY_KEY' || msg.includes('Tavily')) {
          // Fall back to DuckDuckGo
          result = await duckduckgoSearch(query, maxResults);
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

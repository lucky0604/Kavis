import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('https', () => ({ default: { get: mockGet }, get: mockGet }));

describe('web_search: DuckDuckGo fallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.TAVILY_API_KEY;
  });

  it('duckduckgoSearch parses HTML results correctly', async () => {
    const { duckduckgoSearch } = await import('./web-search');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => `
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">Example Result 1</a>
        <a class="result__snippet">This is the first snippet text</a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2">Example Result 2</a>
        <a class="result__snippet">Second snippet here</a>
      `,
    });

    const result = await duckduckgoSearch('test query', 5);
    expect(result.engine).toBe('duckduckgo');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].url).toBe('https://example.com/page1');
    expect(result.results[0].title).toContain('Example Result 1');
    expect(result.results[0].snippet).toBe('This is the first snippet text');
  });

  it('tavilySearch throws NO_TAVILY_KEY when key missing', async () => {
    const { tavilySearch } = await import('./web-search');
    await expect(tavilySearch('test', 5)).rejects.toThrow('NO_TAVILY_KEY');
  });

  it('tavilySearch returns results when key is set', async () => {
    process.env.TAVILY_API_KEY = 'test-key';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: 'Tavily Result', url: 'https://tavily.com/result', content: 'From Tavily API' },
        ],
      }),
    });

    const { tavilySearch } = await import('./web-search');
    const result = await tavilySearch('test', 5);
    expect(result.engine).toBe('tavily');
    expect(result.results[0].title).toBe('Tavily Result');
  });

  it('duckduckgoSearch handles empty results gracefully', async () => {
    const { duckduckgoSearch } = await import('./web-search');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html><body>No results found</body></html>',
    });

    const result = await duckduckgoSearch('obscure query', 5);
    expect(result.engine).toBe('duckduckgo');
    expect(result.results).toHaveLength(0);
  });
});

describe('web_search: Bing fallback', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('bingSearch parses HTML results correctly', async () => {
    mockGet.mockImplementationOnce((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
      const html = `
        <li class="b_algo">
          <h2><a href="https://example.com/bing1">Bing Result 1</a></h2>
          <div class="b_caption"><p>First bing snippet text here</p></div>
        </li>
        <li class="b_algo">
          <h2><a href="https://example.com/bing2">Bing Result 2</a></h2>
          <div class="b_caption"><p>Second bing snippet</p></div>
        </li>
      `;
      const res = {
        statusCode: 200,
        on: vi.fn((event: string, handler: (chunk?: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from(html));
          if (event === 'end') setTimeout(() => handler(), 0);
        }),
      };
      cb(res);
      return { on: vi.fn(), destroy: vi.fn() };
    });

    const { bingSearch } = await import('./web-search');
    const result = await bingSearch('test query', 5);
    expect(result.engine).toBe('bing');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].url).toBe('https://example.com/bing1');
    expect(result.results[0].title).toContain('Bing Result 1');
    expect(result.results[0].snippet).toBe('First bing snippet text here');
  });

  it('bingSearch handles empty results gracefully', async () => {
    mockGet.mockImplementationOnce((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
      const res = {
        statusCode: 200,
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'end') setTimeout(() => handler(), 0);
        }),
      };
      cb(res);
      return { on: vi.fn(), destroy: vi.fn() };
    });

    const { bingSearch } = await import('./web-search');
    const result = await bingSearch('obscure query', 5);
    expect(result.engine).toBe('bing');
    expect(result.results).toHaveLength(0);
  });
});

describe('web_search: bingSearch error paths', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('rejects on HTTP >=400', async () => {
    mockGet.mockImplementationOnce((_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
      cb({ statusCode: 403, on: vi.fn(), resume: vi.fn() });
      return { on: vi.fn(), destroy: vi.fn() };
    });

    const { bingSearch } = await import('./web-search');
    await expect(bingSearch('query', 5)).rejects.toThrow('Bing HTTP 403');
  });

  it('rejects on network error', async () => {
    mockGet.mockImplementationOnce(() => {
      const req = { on: vi.fn(), destroy: vi.fn() };
      setImmediate(() => {
        const errorCb = req.on.mock.calls.find((call) => call[0] === 'error')?.[1];
        if (errorCb) errorCb(new Error('ENOTFOUND'));
      });
      return req;
    });

    const { bingSearch } = await import('./web-search');
    await expect(bingSearch('query', 5)).rejects.toThrow('ENOTFOUND');
  });

  it('rejects on timeout', async () => {
    mockGet.mockImplementationOnce(() => {
      const req = { on: vi.fn(), destroy: vi.fn() };
      setImmediate(() => {
        const timeoutCb = req.on.mock.calls.find((call) => call[0] === 'timeout')?.[1];
        if (timeoutCb) timeoutCb();
      });
      return req;
    });

    const { bingSearch } = await import('./web-search');
    await expect(bingSearch('query', 5)).rejects.toThrow('Bing request timed out');
  });

  it('rejects on stream error', async () => {
    mockGet.mockImplementationOnce((_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
      const res = {
        statusCode: 200,
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === 'error') setImmediate(() => handler(new Error('stream error')));
        }),
      };
      cb(res);
      return { on: vi.fn(), destroy: vi.fn() };
    });

    const { bingSearch } = await import('./web-search');
    await expect(bingSearch('query', 5)).rejects.toThrow('stream error');
  });
});

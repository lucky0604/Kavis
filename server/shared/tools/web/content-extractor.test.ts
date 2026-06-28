import { describe, it, expect } from 'vitest';
import { extractContent } from '../../tools/web/content-extractor';

describe('content-extractor', () => {
  it('extracts content from simple HTML', async () => {
    const html = '<html><body><article><h1>Title</h1><p>Content paragraph</p></article></body></html>';
    const result = await extractContent(html, 'https://example.com/');
    expect(result.textContent.length).toBeGreaterThan(0);
    expect(result.textContent).toContain('Title');
    expect(result.textContent).toContain('Content paragraph');
  });

  it('falls back to raw text when article extraction fails', async () => {
    const html = '<html><body>Just some plain text without article tags</body></html>';
    const result = await extractContent(html, 'https://example.com/');
    expect(result.textContent.length).toBeGreaterThan(0);
    expect(result.textContent).toContain('plain text');
  });

  it('strips script and style tags', async () => {
    const html = '<html><head><style>body{color:red}</style></head><body><script>alert("x")</script><p>Hello</p></body></html>';
    const result = await extractContent(html, 'https://example.com/');
    expect(result.textContent).not.toContain('alert');
    expect(result.textContent).not.toContain('color');
    expect(result.textContent).toContain('Hello');
  });

  it('returns (empty page) for empty HTML', async () => {
    const result = await extractContent('', 'https://example.com/');
    expect(result.textContent).toBe('(empty page)');
  });
});

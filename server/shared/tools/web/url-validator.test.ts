import { describe, it, expect } from 'vitest';
import { validateUrlForFetch, validateRedirectChain } from '../../tools/web/url-validator';

describe('url-validator', () => {
  it('blocks file:// protocol', async () => {
    const result = await validateUrlForFetch('file:///etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protocol');
  });

  it('blocks localhost', async () => {
    const result = await validateUrlForFetch('http://localhost:3000/api');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('localhost');
  });

  it('blocks private IP 127.0.0.1', async () => {
    const result = await validateUrlForFetch('http://127.0.0.1:8080/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('private');
  });

  it('blocks private IP 10.x.x.x', async () => {
    const result = await validateUrlForFetch('http://10.0.0.1/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('private');
  });

  it('blocks private IP 192.168.x.x', async () => {
    const result = await validateUrlForFetch('http://192.168.1.1/');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('private');
  });

  it('allows public URLs', async () => {
    const result = await validateUrlForFetch('https://example.com/');
    // This may fail if DNS is unavailable in CI, but should pass in most environments
    expect(result.allowed).toBe(true);
  });

  it('rejects invalid URL format', async () => {
    const result = await validateUrlForFetch('not-a-url');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid');
  });

  it('validateRedirectChain blocks if any URL is blocked', async () => {
    const result = await validateRedirectChain([
      'https://example.com/',
      'http://127.0.0.1/',
    ]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('private');
  });
});

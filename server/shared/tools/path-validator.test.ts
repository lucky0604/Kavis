import { describe, it, expect } from 'vitest';
import { resolveToolPath } from './path-validator';

describe('resolveToolPath', () => {
  it('accepts absolute paths without workspace', () => {
    const resolved = resolveToolPath('/tmp', '');
    expect(resolved).toBeTruthy();
  });

  it('resolves relative paths against cwd when workspace is empty', () => {
    // When no workspace is configured, fall back to process.cwd()
    // so tools work out of the box in packaged AppImage builds.
    const resolved = resolveToolPath('src/foo.ts', '');
    expect(resolved.endsWith('src/foo.ts')).toBe(true);
    expect(resolved.startsWith('/')).toBe(true);
  });

  it('resolves relative paths against workspace', () => {
    const resolved = resolveToolPath('package.json', process.cwd());
    expect(resolved.endsWith('package.json')).toBe(true);
  });
});

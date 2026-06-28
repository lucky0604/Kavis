import { describe, it, expect } from 'vitest';
import { buildUnifiedDiff, diffLines } from './unified-diff';

describe('unified-diff', () => {
  it('diffLines detects add and remove', () => {
    const ops = diffLines('a\nb', 'a\nc');
    expect(ops.some((o) => o.type === 'remove' && o.line === 'b')).toBe(true);
    expect(ops.some((o) => o.type === 'add' && o.line === 'c')).toBe(true);
  });

  it('buildUnifiedDiff formats hunks', () => {
    const diff = buildUnifiedDiff('line1\nline2\n', 'line1\nline3\n', 'src/foo.ts');
    expect(diff).toContain('--- a/src/foo.ts');
    expect(diff).toContain('+++ b/src/foo.ts');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+line3');
  });

  it('buildUnifiedDiff treats new file as all additions', () => {
    const diff = buildUnifiedDiff('', 'hello\nworld', 'new.txt');
    expect(diff).toContain('+hello');
    expect(diff).toContain('+world');
  });

  it('buildUnifiedDiff reports no changes', () => {
    const diff = buildUnifiedDiff('same', 'same', 'x.ts');
    expect(diff).toContain('(no changes)');
  });
});

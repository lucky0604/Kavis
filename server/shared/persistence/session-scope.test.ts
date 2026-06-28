import { describe, it, expect } from 'vitest';
import { sessionMatchesScope, CODE_MODE_SESSION_AGENT } from '../../../shared/types';

describe('sessionMatchesScope', () => {
  it('includes only code-mode agent in code-mode scope', () => {
    expect(sessionMatchesScope(CODE_MODE_SESSION_AGENT, 'code-mode')).toBe(true);
    expect(sessionMatchesScope('work', 'code-mode')).toBe(false);
    expect(sessionMatchesScope('code/agentic', 'code-mode')).toBe(false);
  });

  it('excludes code-mode agent from work scope', () => {
    expect(sessionMatchesScope('work', 'work')).toBe(true);
    expect(sessionMatchesScope('code/agentic', 'work')).toBe(true);
    expect(sessionMatchesScope(CODE_MODE_SESSION_AGENT, 'work')).toBe(false);
  });
});

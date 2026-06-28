import { describe, it, expect } from 'vitest';
import { rejectOutsideWorkspaceShell } from './workspace-context';

describe('rejectOutsideWorkspaceShell', () => {
  const ws = '/Users/me/projects/Kavis';

  it('blocks find starting from home', () => {
    const err = rejectOutsideWorkspaceShell(
      "find ~ -maxdepth 6 -type d -name '*foo*'",
      ws,
    );
    expect(err).toMatch(/blocked/i);
  });

  it('blocks expanduser in python one-liner', () => {
    const err = rejectOutsideWorkspaceShell(
      "python3 -c \"import os; os.path.expanduser('~')\"",
      ws,
    );
    expect(err).toMatch(/blocked/i);
  });

  it('allows find within workspace', () => {
    const err = rejectOutsideWorkspaceShell('find src -name "*.ts"', ws);
    expect(err).toBeNull();
  });
});

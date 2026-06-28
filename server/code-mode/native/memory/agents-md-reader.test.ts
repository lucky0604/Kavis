import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  readProjectRules,
  hasProjectRulesMessage,
  projectRulesMarker,
  MAX_PROJECT_RULES_BYTES,
} from './agents-md-reader';

describe('agents-md-reader', () => {
  const tempDir = path.join(process.cwd(), 'temp-agents-md-' + crypto.randomUUID());

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers AGENTS.md over CLAUDE.md', async () => {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), 'agents rules', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), 'claude rules', 'utf-8');
    const rules = await readProjectRules(tempDir);
    expect(rules).toBe('agents rules');
  });

  it('falls back to CLAUDE.md when AGENTS.md is missing', async () => {
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), 'claude only', 'utf-8');
    const rules = await readProjectRules(tempDir);
    expect(rules).toBe('claude only');
  });

  it('returns null when no rules file exists', async () => {
    expect(await readProjectRules(tempDir)).toBeNull();
  });

  it('truncates oversized rules files', async () => {
    const big = 'x'.repeat(MAX_PROJECT_RULES_BYTES + 1000);
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), big, 'utf-8');
    const rules = await readProjectRules(tempDir);
    expect(rules).toContain('[Truncated:');
    expect(rules!.length).toBeLessThan(big.length);
  });

  it('detects project rules marker in content', () => {
    expect(hasProjectRulesMessage(`${projectRulesMarker()}\nfoo`)).toBe(true);
    expect(hasProjectRulesMessage('no marker here')).toBe(false);
  });
});

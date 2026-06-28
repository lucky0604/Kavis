import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveModeRole } from '../../routes/chat';
import { SearchReplaceEngine } from '../shared/patch/search-replace';

// Side-effect imports to register tools in the registry for testing
import '../../shared/tools/read-file';
import '../../shared/tools/patch-file';
import '../../shared/tools/shell-exec';
import '../../shared/tools/write-file';

// Mock the OpenAIAdapter or streamChat
const mockStreamChat = vi.fn();
vi.mock('../../shared/ai/openai-adapter', () => {
  return {
    OpenAIAdapter: class {
      streamChat = mockStreamChat;
    },
  };
});

describe('Custom Coding Agent MVP Integration', () => {
  const tempDir = path.join(process.cwd(), 'temp-custom-agent-test-' + crypto.randomUUID());

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should resolve correct tools and system prompt for custom role', () => {
    const { resolvedMode, resolvedRole, tools } = resolveModeRole('code', 'custom');
    expect(resolvedMode).toBe('code');
    expect(resolvedRole).toBe('custom');

    const toolNames = tools.map((t) => t.name);
    // Custom role should only have read_file, patch_file, shell_exec
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('patch_file');
    expect(toolNames).toContain('shell_exec');
    expect(toolNames).not.toContain('write_file'); // write_file is filtered out!
  });

  it('should successfully apply patch_file using SearchReplaceEngine', () => {
    const filePath = path.join(tempDir, 'test.txt');
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3', 'utf-8');

    const patch = `<<<<<<< SEARCH
line 2
=======
line 2 modified
>>>>>>> REPLACE`;

    const engine = new SearchReplaceEngine();
    const result = engine.applyPatch(fs.readFileSync(filePath, 'utf-8'), patch);

    expect(result.success).toBe(true);
    expect(result.newContent).toBe('line 1\nline 2 modified\nline 3');
  });
});

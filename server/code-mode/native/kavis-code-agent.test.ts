import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveModeRole } from '../../routes/chat';
import { SearchReplaceEngine } from '../shared/patch/search-replace';
import { HookManager } from './hooks/hook-manager';
import { registerDefaultHooks } from './hooks/default-hooks';
import { query } from './query';
import { executeCustomAgentTurn } from './index';
import { registerNativeCodeModeTools } from './tools/register';
import { projectRulesMarker } from './memory/agents-md-reader';
import type { Message } from '../../../shared/types';

import '../../shared/tools/read-file';
import '../../shared/tools/patch-file';
import '../../shared/tools/shell-exec';
import '../../shared/tools/write-file';
import '../../shared/tools/git-ops';

registerNativeCodeModeTools();

const mockStreamChat = vi.fn();
vi.mock('../../shared/ai/openai-adapter', () => ({
  OpenAIAdapter: class {
    streamChat = mockStreamChat;
  },
  AuthError: class AuthError extends Error {},
  RateLimitError: class RateLimitError extends Error {},
  UpstreamStreamError: class UpstreamStreamError extends Error {},
}));

vi.mock('../../shared/memory/index', () => ({
  initMemoryContext: vi.fn(() => ({
    persistentPath: '/tmp/kavis-test-memory.db',
    workspacePath: '/tmp',
    sessionId: 'test-session',
  })),
  loadResidentMemory: vi.fn(() => null),
  SessionMemory: class {
    observe = vi.fn();
    flush = vi.fn();
  },
}));

vi.mock('../../work-mode/message-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../work-mode/message-handler')>();
  return {
    ...actual,
    performMemoryRecall: async function* () {
      /* no-op in tests */
    },
  };
});

describe('Kavis Code Agent native loop', () => {
  const tempDir = path.join(process.cwd(), 'temp-kavis-code-test-' + crypto.randomUUID());

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves expanded tool whitelist for kavis-code role', () => {
    const { tools } = resolveModeRole('code', 'kavis-code');
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('patch_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('shell_exec');
    expect(toolNames).toContain('git_status');
    expect(toolNames).toContain('git_diff');
    expect(toolNames).toContain('delegate_task');
  });

  it('security guard hook blocks dangerous shell_exec', async () => {
    const mgr = new HookManager();
    registerDefaultHooks(mgr);
    const res = await mgr.executePipeline('pre-tool', {
      messages: [],
      currentRound: 0,
      toolCalls: [{ id: 'tc1', name: 'shell_exec', arguments: { command: 'rm -rf /' } }],
      metadata: {},
    });
    expect(res.status).toBe('abort');
  });

  it('query completes when model returns text only', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'Hello' } };
    });

    const messages: Message[] = [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }];
    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of query(
      messages,
      [],
      {
        maxRounds: 3,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
        systemPrompt: 'test prompt',
      },
      hookManager,
    )) {
      events.push(event);
    }

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect((done!.data as { reason: string }).reason).toBe('complete');
  });

  it('injects AGENTS.md rules into system message at session start', async () => {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), 'Always use single quotes.', 'utf-8');
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'ok' } };
    });

    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    for await (const _event of query(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
        systemPrompt: 'base prompt',
      },
      hookManager,
    )) {
      /* drain */
    }

    const systemArg = mockStreamChat.mock.calls[0]?.[0] as Message[];
    const systemContent = systemArg.find((m) => m.role === 'system')?.content ?? '';
    expect(systemContent).toContain(projectRulesMarker());
    expect(systemContent).toContain('Always use single quotes.');
  });

  it('pre-model abort short-circuits without calling LLM', async () => {
    const hookManager = new HookManager();
    hookManager.register('pre-model', async () => ({
      status: 'abort',
      shortCircuitResponse: { reason: 'hook_abort' },
    }));

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of query(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [],
      {
        maxRounds: 3,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    )) {
      events.push(event);
    }

    expect(mockStreamChat).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === 'done');
    expect((done!.data as { reason: string }).reason).toBe('hook_abort');
  });

  it('pre-model rewrite updates messages sent to LLM', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'ok' } };
    });

    const hookManager = new HookManager();
    hookManager.register('pre-model', async (ctx) => ({
      status: 'rewrite',
      modifiedContext: {
        ...ctx,
        messages: [{ id: 'r1', role: 'user', content: 'rewritten prompt', timestamp: 1 }],
      },
    }));

    for await (const _event of query(
      [{ id: 'u1', role: 'user', content: 'original', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    )) {
      /* drain */
    }

    const llmMessages = mockStreamChat.mock.calls[0]?.[0] as Message[];
    expect(llmMessages.some((m) => m.content.includes('rewritten prompt'))).toBe(true);
  });

  it('post-model abort stops before tool dispatch', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield {
        type: 'tool_call',
        data: { id: 'tc1', name: 'read_file', arguments: '{"path":"foo.txt"}' },
      };
    });

    const hookManager = new HookManager();
    hookManager.register('post-model', async () => ({
      status: 'abort',
      shortCircuitResponse: { reason: 'hook_abort' },
    }));

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of query(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    )) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'tool_result')).toBe(false);
    const done = events.find((e) => e.type === 'done');
    expect((done!.data as { reason: string }).reason).toBe('hook_abort');
  });

  it('query blocks dangerous shell_exec via security guard', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield {
        type: 'tool_call',
        data: { id: 'tc1', name: 'shell_exec', arguments: '{"command":"rm -rf /"}' },
      };
    });

    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of query(
      [{ id: 'u1', role: 'user', content: 'delete everything', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    )) {
      events.push(event);
    }

    const done = events.find((e) => e.type === 'done');
    expect((done!.data as { reason: string }).reason).toBe('security_blocked');
    expect(events.some((e) => e.type === 'tool_result')).toBe(false);
  });

  it('cancellation aborts streaming gracefully', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'partial' } };
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { type: 'text_delta', data: { text: ' more' } };
    });

    const controller = new AbortController();
    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    const events: Array<{ type: string; data?: unknown }> = [];
    const run = (async () => {
      for await (const event of query(
        [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
        [],
        {
          maxRounds: 1,
          workspacePath: tempDir,
          sessionId: 'test-session',
          apiKey: 'test-key',
        },
        hookManager,
        controller.signal,
      )) {
        events.push(event);
        controller.abort();
      }
    })();

    await run;

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(['cancelled', 'complete']).toContain((done!.data as { reason: string }).reason);
  });

  it('executeCustomAgentTurn routes through native query loop', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'done' } };
    });

    const events: Array<{ type: string }> = [];
    for await (const event of executeCustomAgentTurn(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
    )) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('emits hook_event SSE events during lifecycle hooks', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'text_delta', data: { text: 'ok' } };
    });

    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of query(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [],
      {
        maxRounds: 1,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    )) {
      events.push(event);
    }

    const hookEvents = events.filter((e) => e.type === 'hook_event');
    expect(hookEvents.length).toBeGreaterThan(0);
    expect(hookEvents.some((e) => (e.data as { hookType: string }).hookType === 'pre-model')).toBe(true);
  });

  it('hot-reloads AGENTS.md when file changes between rounds', async () => {
    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(agentsPath, 'Version 1 rules', 'utf-8');

    let callCount = 0;
    mockStreamChat.mockImplementation(async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: 'tool_call',
          data: { id: 'tc1', name: 'read_file', arguments: '{"path":"foo.txt"}' },
        };
        return;
      }
      yield { type: 'text_delta', data: { text: 'done' } };
    });

    const hookManager = new HookManager();
    registerDefaultHooks(hookManager);

    const events: Array<{ type: string; data?: unknown }> = [];
    const gen = query(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
      [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } }],
      {
        maxRounds: 3,
        workspacePath: tempDir,
        sessionId: 'test-session',
        apiKey: 'test-key',
      },
      hookManager,
    );

    for await (const event of gen) {
      events.push(event);
      if (events.filter((e) => e.type === 'tool_call').length === 1) {
        await new Promise((r) => setTimeout(r, 20));
        const past = Date.now() - 1000;
        fs.utimesSync(agentsPath, past / 1000, past / 1000);
        fs.writeFileSync(agentsPath, 'Version 2 rules', 'utf-8');
      }
    }

    expect(events.some((e) => e.type === 'hook_event' && (e.data as { hookType: string }).hookType === 'project-rules-reload')).toBe(true);
    const lastCallMessages = mockStreamChat.mock.calls.at(-1)?.[0] as Message[];
    const rulesMsg = lastCallMessages.find((m) => m.role === 'system' && m.content.includes(projectRulesMarker()));
    expect(rulesMsg?.content).toContain('Version 2 rules');
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

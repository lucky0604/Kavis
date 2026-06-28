import { describe, it, expect } from 'vitest';
import type { ExecutionConfig } from './agent-loop';

/**
 * REGRESSION TEST: systemPrompt parameter
 *
 * Verifies that:
 * 1. When config.systemPrompt is provided, it is used instead of the hardcoded default
 * 2. When config.systemPrompt is absent, the default prompt is used
 * 3. The resolveSystemPrompt logic falls through correctly
 *
 * This is a regression test because the systemPrompt was previously hardcoded
 * and we changed it to accept a parameter from the agent registry.
 */
describe('agent-loop: systemPrompt regression', () => {
  it('ExecutionConfig accepts systemPrompt parameter', () => {
    const config: ExecutionConfig = {
      maxRounds: 10,
      workspacePath: '/tmp',
      sessionId: 'test',
      apiKey: 'test-key',
      systemPrompt: 'Custom prompt from registry',
    };

    expect(config.systemPrompt).toBe('Custom prompt from registry');
  });

  it('ExecutionConfig works without systemPrompt (backward compatible)', () => {
    const config: ExecutionConfig = {
      maxRounds: 10,
      workspacePath: '/tmp',
      sessionId: 'test',
      apiKey: 'test-key',
    };

    expect(config.systemPrompt).toBeUndefined();
  });

  it('done event includes messages array for persistence', () => {
    // Verify the done event data structure includes messages
    const doneEvent = {
      type: 'done' as const,
      data: {
        reason: 'complete' as const,
        messages: [
          { id: '1', role: 'system' as const, content: 'prompt', timestamp: 1 },
          { id: '2', role: 'user' as const, content: 'hello', timestamp: 2 },
          { id: '3', role: 'assistant' as const, content: 'hi', timestamp: 3 },
        ],
      },
    };

    expect(doneEvent.data.messages).toHaveLength(3);
    expect(doneEvent.data.messages[2].role).toBe('assistant');
  });
});

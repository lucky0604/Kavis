import { describe, it, expect } from 'vitest';
import { applyEventToMessages } from './code-mode-session-events';

describe('applyEventToMessages hook_event', () => {
  it('appends hook events to the last assistant message', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'hi' },
      { id: 'a1', role: 'assistant' as const, content: '' },
    ];

    const updated = applyEventToMessages(messages, {
      type: 'hook_event',
      data: { hookType: 'pre-model', status: 'start', round: 0 },
    });

    expect(updated[1].hookEvents).toHaveLength(1);
    expect(updated[1].hookEvents![0].hookType).toBe('pre-model');
    expect(updated[1].hookEvents![0].status).toBe('start');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { applyHookResult, runHookPipeline, triggerOnStop } from './query-helpers';
import { HookManager } from './hooks/hook-manager';
import type { Message } from '../../../shared/types';

const baseMessages: Message[] = [
  { id: '1', role: 'user', content: 'hello', timestamp: 0 },
];

describe('query-helpers', () => {
  it('applyHookResult aborts with reason from shortCircuitResponse', () => {
    const result = applyHookResult(
      { status: 'abort', shortCircuitResponse: { reason: 'security_blocked' } },
      baseMessages,
    );
    expect(result.abort).toBe(true);
    expect(result.reason).toBe('security_blocked');
  });

  it('applyHookResult applies modifiedContext on rewrite', () => {
    const rewritten: Message[] = [{ id: '2', role: 'user', content: 'rewritten', timestamp: 1 }];
    const result = applyHookResult(
      { status: 'rewrite', modifiedContext: { messages: rewritten, currentRound: 0, metadata: {} } },
      baseMessages,
    );
    expect(result.abort).toBe(false);
    expect(result.messages).toEqual(rewritten);
  });

  it('applyHookResult applies modifiedContext on continue with modifiedContext', () => {
    const updated: Message[] = [{ id: '3', role: 'user', content: 'updated', timestamp: 2 }];
    const result = applyHookResult(
      { status: 'continue', modifiedContext: { messages: updated, currentRound: 0, metadata: {} } },
      baseMessages,
    );
    expect(result.messages).toEqual(updated);
  });

  it('runHookPipeline emits start and result hook_event', async () => {
    const mgr = new HookManager();
    const events: Array<{ type: string; data?: unknown }> = [];
    const gen = runHookPipeline(mgr, 'pre-model', {
      messages: baseMessages,
      currentRound: 1,
      metadata: {},
    });
    while (true) {
      const step = await gen.next();
      if (step.done) break;
      events.push(step.value);
    }
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('hook_event');
    expect((events[0].data as { status: string }).status).toBe('start');
    expect((events[1].data as { status: string }).status).toBe('continue');
  });

  it('triggerOnStop runs on-stop hooks and yields hook_event + done', async () => {
    const mgr = new HookManager();
    const onStop = vi.fn(async () => ({ status: 'continue' as const }));
    mgr.register('on-stop', onStop);

    const events: Array<{ type: string; data?: unknown }> = [];
    for await (const event of triggerOnStop(mgr, baseMessages, 2, 'complete')) {
      events.push(event);
    }

    expect(onStop).toHaveBeenCalledOnce();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'hook_event')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
    expect((events[events.length - 1].data as { reason: string }).reason).toBe('complete');
  });
});

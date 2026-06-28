import { describe, it, expect } from 'vitest';
import { HookManager } from './hook-manager';
import type { HookContext } from './types';

function baseCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    messages: [{ id: '1', role: 'user', content: 'hi', timestamp: 0 }],
    currentRound: 0,
    metadata: {},
    ...overrides,
  };
}

describe('HookManager', () => {
  it('runs hooks in registration order', async () => {
    const mgr = new HookManager();
    const order: number[] = [];
    mgr.register('pre-model', async () => {
      order.push(1);
      return { status: 'continue' };
    });
    mgr.register('pre-model', async () => {
      order.push(2);
      return { status: 'continue' };
    });
    await mgr.executePipeline('pre-model', baseCtx());
    expect(order).toEqual([1, 2]);
  });

  it('short-circuits on abort', async () => {
    const mgr = new HookManager();
    mgr.register('pre-tool', async () => ({
      status: 'abort',
      shortCircuitResponse: { reason: 'security_blocked' },
    }));
    mgr.register('pre-tool', async () => {
      throw new Error('should not run');
    });
    const res = await mgr.executePipeline('pre-tool', baseCtx());
    expect(res.status).toBe('abort');
    expect(res.shortCircuitResponse?.reason).toBe('security_blocked');
  });

  it('applies rewrite and returns rewrite status', async () => {
    const mgr = new HookManager();
    mgr.register('pre-model', async (ctx) => ({
      status: 'rewrite',
      modifiedContext: {
        ...ctx,
        messages: [{ id: '2', role: 'user', content: 'rewritten', timestamp: 1 }],
      },
    }));
    const res = await mgr.executePipeline('pre-model', baseCtx());
    expect(res.status).toBe('rewrite');
    expect(res.modifiedContext?.messages[0].content).toBe('rewritten');
  });

  it('continues when all hooks return continue', async () => {
    const mgr = new HookManager();
    mgr.register('post-model', async () => ({ status: 'continue' }));
    const res = await mgr.executePipeline('post-model', baseCtx());
    expect(res.status).toBe('continue');
    expect(res.modifiedContext?.messages).toHaveLength(1);
  });
});

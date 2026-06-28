import type { HookType, HookContext, HookResult, HookFn } from './types';

const HOOK_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export class HookManager {
  private hooks: Record<HookType, HookFn[]> = {
    'pre-model': [],
    'post-model': [],
    'pre-tool': [],
    'post-tool': [],
    'on-stop': [],
  };

  register(type: HookType, fn: HookFn): void {
    this.hooks[type].push(fn);
  }

  async executePipeline(type: HookType, context: HookContext): Promise<HookResult> {
    let currentCtx: HookContext = { ...context, metadata: { ...context.metadata } };
    let rewritten = false;

    for (const hook of this.hooks[type]) {
      let res: HookResult;
      try {
        res = await withTimeout(hook(currentCtx), HOOK_TIMEOUT_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[HookManager] ${type} hook failed:`, message);
        continue;
      }

      if (res.status === 'abort') {
        return {
          status: 'abort',
          modifiedContext: currentCtx,
          shortCircuitResponse: res.shortCircuitResponse,
        };
      }

      if (res.status === 'rewrite' && res.modifiedContext) {
        currentCtx = res.modifiedContext;
        rewritten = true;
      }
    }

    return {
      status: rewritten ? 'rewrite' : 'continue',
      modifiedContext: currentCtx,
    };
  }
}

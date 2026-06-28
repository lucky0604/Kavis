import type { Message } from '../../../shared/types';
import type { StreamEvent } from '../../shared/ai/adapter';
import type { HookManager } from './hooks/hook-manager';
import type { HookContext, HookResult, HookType, StopReason } from './hooks/types';

export function applyHookResult(
  result: HookResult,
  messages: Message[],
): { messages: Message[]; abort: boolean; reason?: StopReason } {
  if (result.status === 'abort') {
    return {
      messages,
      abort: true,
      reason: result.shortCircuitResponse?.reason ?? 'hook_abort',
    };
  }
  const nextMessages = result.modifiedContext?.messages ?? messages;
  return { messages: nextMessages, abort: false };
}

export async function* runHookPipeline(
  hookManager: HookManager,
  hookType: HookType,
  context: HookContext,
): AsyncGenerator<StreamEvent, HookResult> {
  yield {
    type: 'hook_event',
    data: { hookType, status: 'start', round: context.currentRound },
  };

  const result = await hookManager.executePipeline(hookType, context);

  yield {
    type: 'hook_event',
    data: {
      hookType,
      status: result.status === 'abort' ? 'abort' : result.status === 'rewrite' ? 'rewrite' : 'continue',
      round: context.currentRound,
    },
  };

  return result;
}

export async function* triggerOnStop(
  hookManager: HookManager,
  messages: Message[],
  round: number,
  reason: StopReason,
): AsyncGenerator<StreamEvent> {
  const hookGen = runHookPipeline(hookManager, 'on-stop', {
    messages,
    currentRound: round,
    metadata: { reason },
  });

  while (true) {
    const step = await hookGen.next();
    if (step.done) break;
    yield step.value;
  }

  yield { type: 'done', data: { reason, messages } };
}

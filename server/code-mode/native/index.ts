import type { Message, ToolDefinition } from '../../../shared/types';
import type { StreamEvent } from '../../shared/ai/adapter';
import type { ExecutionConfig } from '../../work-mode/agent-loop';
import { HookManager } from './hooks/hook-manager';
import { registerDefaultHooks } from './hooks/default-hooks';
import { query } from './query';
import { TaskManager } from './tasks/task-manager';
import { registerNativeCodeModeTools } from './tools/register';

registerNativeCodeModeTools();

/**
 * Execute a dialog turn for the native Kavis Code agent.
 * Uses an independent query loop with lifecycle hooks (Phase 1 MVP).
 */
export async function* executeCustomAgentTurn(
  messages: Message[],
  toolDefs: { name: string; description: string; parameters: ToolDefinition['parameters'] }[],
  config: ExecutionConfig,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const hookManager = new HookManager();
  registerDefaultHooks(hookManager);
  const taskManager = new TaskManager();
  yield* query(messages, toolDefs, config, hookManager, signal, taskManager);
}

export { query } from './query';

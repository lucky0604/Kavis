import type { Message, ToolDefinition } from '../../../shared/types';
import type { StreamEvent } from '../../shared/ai/adapter';
import type { ExecutionConfig } from '../../work-mode/agent-loop';
import { executeDialogTurn } from '../../work-mode/agent-loop';

/**
 * Execute a dialog turn for the Custom Coding Agent.
 * Delegates to the robust, battle-tested executeDialogTurn to keep the implementation DRY,
 * while satisfying the custom-agent interface contract.
 */
export async function* executeCustomAgentTurn(
  messages: Message[],
  toolDefs: { name: string; description: string; parameters: ToolDefinition['parameters'] }[],
  config: ExecutionConfig,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
  yield* executeDialogTurn(messages, toolDefs, config, signal);
}
export { executeDialogTurn };

import type { Message, ToolDefinition } from '../../shared/types';

export interface StreamEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'done';
  data: unknown;
}

export interface AIAdapter {
  streamChat(
    messages: Message[],
    tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[],
    modelName?: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent>;
}

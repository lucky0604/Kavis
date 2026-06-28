import type { Message, ToolDefinition } from '../../../shared/types';

export type StreamEvent =
  | { type: 'text_delta'; data: { text: string } }
  | { type: 'tool_call'; data: { id: string; name: string; arguments: string } }
  | { type: 'tool_result'; data: { id: string; name: string; success: boolean; output: string } }
  | { type: 'thinking'; data: { text?: string } }
  | { type: 'memory_recall'; data: { count: number; memories: Array<{ id: string; content: string; category: string; source: string; staleness?: string }> } }
  | { type: 'skill_review'; data: { count: number; skills: Array<{ id: string; name: string; description: string; status: string }>; message?: string } }
  | { type: 'evolution_event'; data: { event: string; detail?: string } }
  | { type: 'approval_required'; data: { id: string; toolCallId: string; name: string; path: string; contentPreview: string; bytes: number } }
  | { type: 'approval_resolved'; data: { id: string; approved: boolean } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: { reason: string; messages?: Message[] } };

export interface AIAdapter {
  streamChat(
    messages: Message[],
    tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[],
    modelName?: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent>;
}

import type { StreamEvent } from './adapter';
import OpenAI from 'openai';

/**
 * OpenAI Chat Completions API finish reasons that indicate a logically
 * complete response. When the upstream sends one of these followed by
 * a transport-layer TCP close, the answer is complete — not truncated.
 */
export const COMPLETE_FINISH_REASONS = new Set([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call',
]);

export interface StreamStats {
  chunksReceived: number;
  bytesReceived: number;
  lastFinishReason: string | null;
}

/**
 * Process an OpenAI streaming response chunk-by-chunk, yielding
 * text_delta and tool_call StreamEvents. Stats are mutated in-place
 * so the caller can inspect progress after an error or return.
 */
export async function* processOpenAIStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  stats: StreamStats
): AsyncGenerator<StreamEvent> {
  const accumulatedToolCalls: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  for await (const chunk of stream) {
    stats.chunksReceived++;
    const delta = chunk.choices[0]?.delta;
    const finishReason = chunk.choices[0]?.finish_reason;
    if (finishReason) stats.lastFinishReason = finishReason;

    if (delta?.content) {
      stats.bytesReceived += delta.content.length;
      yield {
        type: 'text_delta',
        data: { text: delta.content },
      };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]) {
        const idx = tc.index;
        if (!accumulatedToolCalls.has(idx)) {
          accumulatedToolCalls.set(idx, {
            id: tc.id || crypto.randomUUID(),
            name: tc.function?.name || '',
            arguments: '',
          });
        }
        const existing = accumulatedToolCalls.get(idx)!;
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) {
          existing.arguments += tc.function.arguments;
          stats.bytesReceived += tc.function.arguments.length;
        }
      }
    }

    if (chunk.choices[0]?.finish_reason === 'tool_calls') {
      for (const [, tc] of accumulatedToolCalls) {
        yield {
          type: 'tool_call',
          data: {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          },
        };
      }
      accumulatedToolCalls.clear();
    }
  }
}

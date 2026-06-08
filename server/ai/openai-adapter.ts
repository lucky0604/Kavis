import type { AIAdapter, StreamEvent } from './adapter';
import type { Message, ToolDefinition } from '../../shared/types';
import OpenAI from 'openai';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class OpenAIAdapter implements AIAdapter {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl || process.env.OPENAI_BASE_URL });
  }

  async *streamChat(
    messages: Message[],
    tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[],
    modelName?: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: modelName || process.env.OPENAI_MODEL || 'gpt-4o',
          messages: messages.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                      name: tc.name,
                      arguments: JSON.stringify(tc.arguments),
                    },
                  })),
                }
              : {}),
          })),
          tools: tools.length > 0 ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })) : undefined,
          stream: true,
        },
        { signal }
      );

      let accumulatedToolCalls: Map<
        number,
        { id: string; name: string; arguments: string }
      > = new Map();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          yield {
            type: 'text_delta',
            data: { text: delta.content },
          };
        }

        // Accumulate tool call deltas
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
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }

        // Emit complete tool calls when finish_reason is tool_calls
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
    } catch (err: unknown) {
      if (err instanceof OpenAI.APIError) {
        switch (err.status) {
          case 401:
            throw new AuthError(err.message);
          case 429:
            throw new RateLimitError(err.message);
          default:
            if (err.status && err.status >= 500) {
              throw new ProviderError(err.message);
            }
            throw err;
        }
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      throw err;
    }
  }
}

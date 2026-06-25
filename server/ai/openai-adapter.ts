import type { AIAdapter, StreamEvent } from './adapter';
import type { Message, ToolDefinition } from '../../shared/types';
import OpenAI from 'openai';
import https from 'https';
import http from 'http';

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

export interface UpstreamErrorContext {
  baseUrl?: string;
  model: string;
  status?: number;
  code?: string;
  cause?: unknown;
}

export class UpstreamStreamError extends Error {
  readonly baseUrl?: string;
  readonly model: string;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;

  constructor(message: string, ctx: UpstreamErrorContext) {
    super(message);
    this.name = 'UpstreamStreamError';
    this.baseUrl = ctx.baseUrl;
    this.model = ctx.model;
    this.status = ctx.status;
    this.code = ctx.code;
    this.cause = ctx.cause;
  }
}

/**
 * Strip credentials (user:pass@) from a URL so it's safe to log or send to the client.
 * Falls back to the raw string if parsing fails — never re-emits credentials on error.
 */
export function sanitizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
    return url;
  } catch {
    return url.replace(/\/\/[^@/]+@/, '//');
  }
}

export class OpenAIAdapter implements AIAdapter {
  private client: OpenAI;
  private baseUrl: string | undefined;
  private static sharedHttpsAgent: https.Agent | undefined;
  private static sharedHttpAgent: http.Agent | undefined;

  /**
   * Shared per-protocol keep-alive agents. Reused across all adapter instances so
   * sockets stay warm between requests — crucial when the same client config issues
   * a long chain of tool-loop requests (avoids re-handshake stalls that surface as
   * 'Premature close' in packaged builds).
   */
  private static getAgent(targetUrl: string | undefined): https.Agent | http.Agent {
    const isHttps = !targetUrl || targetUrl.startsWith('https:');
    if (isHttps) {
      if (!OpenAIAdapter.sharedHttpsAgent) {
        OpenAIAdapter.sharedHttpsAgent = new https.Agent({
          keepAlive: true,
          keepAliveMsecs: 30_000,
          maxSockets: 64,
          maxFreeSockets: 16,
          timeout: 600_000,
          scheduling: 'lifo',
        });
      }
      return OpenAIAdapter.sharedHttpsAgent;
    }
    if (!OpenAIAdapter.sharedHttpAgent) {
      OpenAIAdapter.sharedHttpAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30_000,
        maxSockets: 64,
        maxFreeSockets: 16,
        timeout: 600_000,
        scheduling: 'lifo',
      });
    }
    return OpenAIAdapter.sharedHttpAgent;
  }

  constructor(apiKey: string, baseUrl?: string) {
    const trimmedBase = baseUrl?.trim() || undefined;
    this.baseUrl = trimmedBase || process.env.OPENAI_BASE_URL;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      timeout: 600_000,
      maxRetries: 2,
      httpAgent: OpenAIAdapter.getAgent(this.baseUrl),
    });
  }

  async *streamChat(
    messages: Message[],
    tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[],
    modelName?: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    const effectiveModel = modelName || process.env.OPENAI_MODEL || 'gpt-4o';
    const sanitizedBase = sanitizeBaseUrl(this.baseUrl);
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: effectiveModel,
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
      // AbortError propagates up unchanged so callers can distinguish user cancel from upstream failure
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }

      if (err instanceof OpenAI.APIError) {
        const ctxMsg = `[${sanitizedBase || 'default'}] ${err.message}`;
        if (err.status === 401) throw new AuthError(ctxMsg);
        if (err.status === 429) throw new RateLimitError(ctxMsg);
        throw new UpstreamStreamError(
          `Provider HTTP ${err.status ?? '?'}: ${err.message}`,
          {
            baseUrl: sanitizedBase,
            model: effectiveModel,
            status: err.status,
            code: err.code ?? undefined,
            cause: err,
          },
        );
      }

      const cause = err instanceof Error ? err : new Error(String(err));
      const code = (cause as NodeJS.ErrnoException).code;
      throw new UpstreamStreamError(
        `Upstream stream broken: ${cause.message} (model=${effectiveModel}, baseUrl=${sanitizedBase || 'default'})`,
        {
          baseUrl: sanitizedBase,
          model: effectiveModel,
          status: undefined,
          code,
          cause: err,
        },
      );
    }
  }
}

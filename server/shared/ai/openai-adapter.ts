import type { AIAdapter, StreamEvent } from './adapter';
import type { Message, ToolDefinition } from '../../../shared/types';
import OpenAI from 'openai';
import { upstreamFetch } from './upstream-fetch';
import { BROWSER_HEADERS } from './headers';
import { prepareRequestConfig } from './openai-request-builder';
import { processOpenAIStream } from './openai-stream-parser';
import { classifyError } from './openai-retry';
import {
  AuthError,
  RateLimitError,
  UpstreamStreamError,
} from './openai-errors';

// Re-export for backward compatibility — these were exported from this module.
export { sanitizeMessagesForUpstream } from './openai-request-builder';
export { AuthError, RateLimitError, UpstreamStreamError } from './openai-errors';
export type { UpstreamErrorContext } from './openai-errors';

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

  constructor(apiKey: string, baseUrl?: string) {
    const trimmedBase = baseUrl?.trim() || undefined;
    this.baseUrl = trimmedBase || process.env.OPENAI_BASE_URL;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
      timeout: 600_000,
      maxRetries: 2,
      defaultHeaders: BROWSER_HEADERS,
      fetch: upstreamFetch,
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
    const MAX_RETRIES = 2;
    let attempt = 0;

    while (true) {
      const startMs = Date.now();

      const { sanitizedMsgs, toolDefs, bodyJson } = prepareRequestConfig(
        messages, tools, effectiveModel
      );
      console.warn('[openai-adapter] request prepared:', {
        model: effectiveModel,
        baseUrl: sanitizedBase,
        msgCount: sanitizedMsgs.length,
        roles: sanitizedMsgs.map((m) => m.role).join(','),
        toolCount: toolDefs?.length ?? 0,
        toolNames: toolDefs?.map((t) => t.function.name).join(',') ?? '',
        bodyBytes: bodyJson.length,
        attempt,
      });

      const stats = { chunksReceived: 0, bytesReceived: 0, lastFinishReason: null as string | null };

      try {
        const stream = await this.client.chat.completions.create(
          {
            model: effectiveModel,
            messages: sanitizedMsgs,
            tools: toolDefs,
            stream: true,
          },
          { signal }
        );

        yield* processOpenAIStream(stream, stats);
        return;
      } catch (err: unknown) {
        const elapsedMs = Date.now() - startMs;
        const classification = classifyError(err, {
          chunksReceived: stats.chunksReceived,
          lastFinishReason: stats.lastFinishReason,
          attempt,
          maxRetries: MAX_RETRIES,
        });
        // abort
        if (classification.isAbort) throw err;
        // OpenAI API-level error (401 / 429 / other HTTP status)
        if (classification.isApiError) {
          const ctxMsg = `[${sanitizedBase || 'default'}] ${classification.apiMessage}`;
          if (classification.apiStatus === 401) throw new AuthError(ctxMsg);
          if (classification.apiStatus === 429) throw new RateLimitError(ctxMsg);
          throw new UpstreamStreamError(
            `Provider HTTP ${classification.apiStatus ?? '?'}: ${classification.apiMessage}`,
            {
              baseUrl: sanitizedBase,
              model: effectiveModel,
              status: classification.apiStatus,
              code: classification.code,
              cause: err,
              chunksReceived: stats.chunksReceived,
              bytesReceived: stats.bytesReceived,
              elapsedMs,
              attempt,
              causeChain: classification.causeChain,
            },
          );
        }
        // logically-complete (finish_reason seen before TCP close)
        if (classification.isLogicallyComplete) {
          console.debug('[openai-adapter] transport closed post-completion (benign):', {
            chunksReceived: stats.chunksReceived,
            bytesReceived: stats.bytesReceived,
            elapsedMs,
            finishReason: stats.lastFinishReason,
            model: effectiveModel,
          });
          return;
        }
        // graceful truncation (mid-content break, not retriable)
        if (classification.isGracefulTruncation) {
          console.warn('[openai-adapter] stream truncated by server (graceful):', {
            attempt,
            chunksReceived: stats.chunksReceived,
            bytesReceived: stats.bytesReceived,
            elapsedMs,
            code: classification.code,
            causeChain: classification.causeChain,
            baseUrl: sanitizedBase,
            model: effectiveModel,
          });
          yield {
            type: 'text_delta',
            data: { text: '\n\n*[⚠ 服务器提前结束了响应流，以上回答可能不完整]*' },
          };
          return;
        }
        // retry
        console.error('[openai-adapter] stream broken:', {
          attempt,
          willRetry: classification.canRetry,
          chunksReceived: stats.chunksReceived,
          bytesReceived: stats.bytesReceived,
          elapsedMs,
          code: classification.code,
          causeChain: classification.causeChain,
          baseUrl: sanitizedBase,
          model: effectiveModel,
        });
        if (classification.canRetry) {
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, classification.backoffMs));
          continue;
        }
        // fatal
        throw new UpstreamStreamError(
          `Upstream stream broken: ${classification.errorMessage} (model=${effectiveModel}, baseUrl=${sanitizedBase || 'default'}, chunks=${stats.chunksReceived}, bytes=${stats.bytesReceived}, elapsed=${elapsedMs}ms, attempt=${attempt})`,
          {
            baseUrl: sanitizedBase,
            model: effectiveModel,
            status: undefined,
            code: classification.code,
            cause: err,
            chunksReceived: stats.chunksReceived,
            bytesReceived: stats.bytesReceived,
            elapsedMs,
            attempt,
            causeChain: classification.causeChain,
          },
        );
      }
    }
  }
}

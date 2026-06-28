import OpenAI from 'openai';
import { COMPLETE_FINISH_REASONS } from './openai-stream-parser';

/**
 * Walk the Node.js error.cause chain (Node 16.9+ standard) and serialize each
 * link's name/code/errno/syscall/message. Critical for distinguishing
 * ERR_STREAM_PREMATURE_CLOSE wrappers from the real underlying network errno
 * (ECONNRESET, EPIPE, ETIMEDOUT, UND_ERR_SOCKET, etc.).
 */
export function summarizeCauseChain(err: unknown, maxDepth = 5): string {
  const links: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < maxDepth && current; i++) {
    if (current instanceof Error) {
      const e = current as NodeJS.ErrnoException & {
        cause?: unknown;
        syscall?: string;
        errno?: number;
      };
      const parts: string[] = [`${e.name || 'Error'}`];
      if (e.code) parts.push(`code=${e.code}`);
      if (typeof e.errno === 'number') parts.push(`errno=${e.errno}`);
      if (e.syscall) parts.push(`syscall=${e.syscall}`);
      if (e.message) parts.push(`msg="${e.message.slice(0, 120)}"`);
      links.push(parts.join(' '));
      current = e.cause;
    } else {
      links.push(`(non-Error: ${String(current).slice(0, 80)})`);
      break;
    }
  }
  return links.join(' -> ');
}

export interface ErrorClassification {
  /** The error is a user-initiated abort — caller should rethrow. */
  isAbort: boolean;
  /** The error is an OpenAI.APIError — caller checks apiStatus to decide. */
  isApiError: boolean;
  apiStatus?: number;
  apiMessage?: string;
  errorMessage: string;
  /** The underlying transport error is ERR_STREAM_PREMATURE_CLOSE or similar. */
  isPrematureClose: boolean;
  /** Stream was logically complete before the transport error (finish_reason seen). */
  isLogicallyComplete: boolean;
  /** Stream was mid-content when transport broke — emit graceful truncation hint. */
  isGracefulTruncation: boolean;
  /** The error is retriable (premature close + 0 chunks + attempts remaining). */
  canRetry: boolean;
  /** Exponential backoff delay in milliseconds (250 * 2^attempt). */
  backoffMs: number;
  /** Serialized error.cause chain for diagnostics. */
  causeChain: string;
  /** Node.js error code (e.g. ERR_STREAM_PREMATURE_CLOSE). */
  code?: string;
}

/**
 * Classify a stream error into an actionable category so the adapter can
 * decide whether to abort, retry, show a truncation hint, or throw.
 *
 * Does NOT import error types from openai-adapter.ts — avoids circular deps.
 * The caller maps classification fields to AuthError / RateLimitError / UpstreamStreamError.
 */
export function classifyError(
  err: unknown,
  context: {
    chunksReceived: number;
    lastFinishReason: string | null;
    attempt: number;
    maxRetries: number;
  }
): ErrorClassification {
  const causeChain = summarizeCauseChain(err);

  // ---- abort -----------------------------------------------------------
  if (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  ) {
    return {
      isAbort: true,
      isApiError: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      isPrematureClose: false,
      isLogicallyComplete: false,
      isGracefulTruncation: false,
      canRetry: false,
      backoffMs: 0,
      causeChain,
    };
  }

  // ---- OpenAI API error ------------------------------------------------
  if (err instanceof OpenAI.APIError) {
    return {
      isAbort: false,
      isApiError: true,
      apiStatus: err.status,
      apiMessage: err.message,
      errorMessage: err.message,
      isPrematureClose: false,
      isLogicallyComplete: false,
      isGracefulTruncation: false,
      canRetry: false,
      backoffMs: 0,
      causeChain,
      code: err.code ?? undefined,
    };
  }

  // ---- generic network / stream error ----------------------------------
  const cause = err instanceof Error ? err : new Error(String(err));
  const code = (cause as NodeJS.ErrnoException).code;
  const errorMessage = cause.message;

  const isPrematureClose =
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    /premature close/i.test(cause.message) ||
    /ERR_STREAM_PREMATURE_CLOSE/.test(causeChain);

  const canRetry =
    isPrematureClose &&
    context.chunksReceived === 0 &&
    context.attempt < context.maxRetries;

  const isLogicallyComplete =
    isPrematureClose &&
    context.lastFinishReason !== null &&
    COMPLETE_FINISH_REASONS.has(context.lastFinishReason);

  const isGracefulTruncation =
    isPrematureClose &&
    context.chunksReceived > 0 &&
    !canRetry &&
    !isLogicallyComplete;

  const backoffMs = canRetry ? 250 * Math.pow(2, context.attempt) : 0;

  return {
    isAbort: false,
    isApiError: false,
    errorMessage,
    isPrematureClose,
    isLogicallyComplete,
    isGracefulTruncation,
    canRetry,
    backoffMs,
    causeChain,
    code,
  };
}

import type { Message } from '../../shared/types';
import type { StreamEvent } from '../shared/ai/adapter';
import type { MemoryContext } from '../shared/memory/memory-types';
import { AuthError, RateLimitError, UpstreamStreamError } from '../shared/ai/openai-adapter';
import { logError } from '../shared/utils/error-log';
import { optionalWorkspaceRoot, workspacePromptBlock, noWorkspacePromptBlock } from '../shared/tools/workspace-context';
import { recallMemories, formatRecalledMemories } from '../shared/memory/index';
import { SessionMemory } from '../shared/memory/index';

// ---- Stream Error Data ----

export interface StreamErrorData {
  message: string;
  kind: 'upstream' | 'auth' | 'rate_limit' | 'cancelled' | 'unknown';
  status?: number;
  baseUrl?: string;
  model?: string;
  code?: string;
  stack?: string;
  chunksReceived?: number;
  bytesReceived?: number;
  elapsedMs?: number;
  attempt?: number;
  causeChain?: string;
}

/**
 * Classify a stream error, build structured error data, and log it.
 */
export function handleStreamError(err: unknown, effectiveModel: string): StreamErrorData {
  const errorData: StreamErrorData = {
    message: err instanceof Error ? err.message : 'AI call failed',
    kind: 'unknown',
    model: effectiveModel,
  };

  if (err instanceof UpstreamStreamError) {
    errorData.kind = 'upstream';
    errorData.status = err.status;
    errorData.baseUrl = err.baseUrl;
    errorData.model = err.model;
    errorData.code = err.code;
    errorData.chunksReceived = err.chunksReceived;
    errorData.bytesReceived = err.bytesReceived;
    errorData.elapsedMs = err.elapsedMs;
    errorData.attempt = err.attempt;
    errorData.causeChain = err.causeChain;
  } else if (err instanceof AuthError) {
    errorData.kind = 'auth';
  } else if (err instanceof RateLimitError) {
    errorData.kind = 'rate_limit';
  }

  if (err instanceof Error && err.stack) {
    errorData.stack = err.stack.split('\n').slice(0, 3).join('\n');
  }

  console.error('[agent-loop] stream error:', {
    kind: errorData.kind,
    status: errorData.status,
    baseUrl: errorData.baseUrl,
    model: errorData.model,
    code: errorData.code,
    chunksReceived: errorData.chunksReceived,
    bytesReceived: errorData.bytesReceived,
    elapsedMs: errorData.elapsedMs,
    attempt: errorData.attempt,
    causeChain: errorData.causeChain,
    message: errorData.message,
  });

  logError({
    source: 'agent-loop',
    message: errorData.message,
    kind: errorData.kind,
    status: errorData.status,
    baseUrl: errorData.baseUrl,
    model: errorData.model,
    code: errorData.code,
    stack: errorData.stack,
    extra: {
      chunksReceived: errorData.chunksReceived,
      bytesReceived: errorData.bytesReceived,
      elapsedMs: errorData.elapsedMs,
      attempt: errorData.attempt,
      causeChain: errorData.causeChain,
    },
  });

  return errorData;
}

// ---- System Prompt Assembly ----

/**
 * Build the full system message content, layering:
 * 1. Base prompt (resolved from config or file)
 * 2. Workspace path block
 * 3. Resident memory (if present)
 */
export function buildSystemContent(
  config: { workspacePath: string },
  residentMemory: string | null,
  resolvedBasePrompt: string,
): string {
  const wsRoot = optionalWorkspaceRoot(config.workspacePath);
  const pathBlock = wsRoot
    ? `\n\n${workspacePromptBlock(wsRoot)}`
    : `\n\n${noWorkspacePromptBlock()}`;
  return residentMemory
    ? `${resolvedBasePrompt}${pathBlock}\n\n${residentMemory}`
    : `${resolvedBasePrompt}${pathBlock}`;
}

// ---- Per-Turn Memory Recall ----

/**
 * Observe the last user message and, after the first round, recall
 * relevant memories. Injects recalled context as a system message
 * and yields memory_recall events for the frontend.
 */
export async function* performMemoryRecall(
  messagesArr: Message[],
  rounds: number,
  sessionMemory: SessionMemory,
  memCtx: MemoryContext,
): AsyncGenerator<StreamEvent> {
  const lastUserMsg = messagesArr.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg) {
    // ---- Memory: Observe user message ----
    sessionMemory.observe(`User: ${lastUserMsg.content.slice(0, 300)}`);
  }
  if (lastUserMsg && rounds > 0) {
    const recalled = recallMemories(lastUserMsg.content, memCtx);
    if (recalled.length > 0) {
      const recallText = formatRecalledMemories(recalled);
      // Inject as system message before this turn
      messagesArr.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: recallText,
        timestamp: Date.now(),
      });
      // Notify frontend
      yield {
        type: 'memory_recall',
        data: { count: recalled.length, memories: recalled },
      };
    }
  }
}

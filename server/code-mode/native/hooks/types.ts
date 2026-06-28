import type { Message, ToolCall } from '../../../../shared/types';

export type HookType = 'pre-model' | 'post-model' | 'pre-tool' | 'post-tool' | 'on-stop';

export type StopReason =
  | 'complete'
  | 'cancelled'
  | 'hook_abort'
  | 'security_blocked'
  | 'error'
  | 'max_rounds'
  | 'loop_detected';

export interface HookMetadata {
  textContent?: string;
  reason?: StopReason;
  [key: string]: string | number | boolean | undefined;
}

export interface HookContext {
  messages: Message[];
  currentRound: number;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ id: string; name: string; success: boolean; output: string }>;
  metadata: HookMetadata;
}

export interface ShortCircuitResponse {
  message?: string;
  reason?: StopReason;
}

export interface HookResult {
  status: 'continue' | 'abort' | 'rewrite';
  modifiedContext?: HookContext;
  shortCircuitResponse?: ShortCircuitResponse;
}

export type HookFn = (ctx: HookContext) => Promise<HookResult>;

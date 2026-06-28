// ---- AI Adapter: Stream Events ----
export type StreamEventType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'memory_recall'
  | 'skill_review'
  | 'evolution_event'
  | 'approval_required'
  | 'approval_resolved'
  | 'hook_event'
  | 'error'
  | 'done';

// ---- SSE Event Payloads ----
export interface SSETextDelta {
  text: string;
}

export interface SSEToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SSEToolResult {
  id: string;
  name: string;
  success: boolean;
  output: string;
}

export interface SSEDone {
  reason: string;
}

export interface SSEMemoryRecall {
  count: number;
  memories: Array<{ id: string; content: string; category: string; source: string; staleness?: string }>;
}

export interface SSESkillReview {
  skill: { id: string; name: string; description: string; status: string };
}

export interface SSEEvolutionEvent {
  event: string;
  detail?: string;
}

export interface SSEApprovalRequired {
  id: string;
  toolCallId: string;
  name: string;
  path: string;
  contentPreview: string;
  bytes: number;
  unifiedDiff?: string;
}

export interface SSEApprovalResolved {
  id: string;
  approved: boolean;
}

export interface SSEHookEvent {
  hookType: string;
  status: 'start' | 'continue' | 'rewrite' | 'abort';
  round?: number;
  detail?: string;
}

// ---- Stream Error ----
export interface StreamErrorEventData {
  message: string;
  kind?: 'upstream' | 'auth' | 'rate_limit' | 'cancelled' | 'unknown';
  status?: number;
  baseUrl?: string;
  model?: string;
  code?: string;
  stack?: string;
}

// ---- Stream Event Discriminated Union ----
import type { Message } from './messages';

export type StreamEvent =
  | { type: 'text_delta'; data: SSETextDelta }
  | { type: 'tool_call'; data: SSEToolCall }
  | { type: 'tool_result'; data: SSEToolResult }
  | { type: 'thinking'; data: { text?: string } }
  | { type: 'memory_recall'; data: SSEMemoryRecall }
  | { type: 'skill_review'; data: SSESkillReview | { count: number; skills: Array<{ id: string; name: string; description: string; status: string }>; message?: string } }
  | { type: 'evolution_event'; data: SSEEvolutionEvent }
  | { type: 'approval_required'; data: SSEApprovalRequired }
  | { type: 'approval_resolved'; data: SSEApprovalResolved }
  | { type: 'hook_event'; data: SSEHookEvent }
  | { type: 'error'; data: StreamErrorEventData }
  | { type: 'done'; data: SSEDone & { messages?: Message[] } };

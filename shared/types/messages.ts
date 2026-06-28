// ---- Tool System ----
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  workspacePath: string;
  sessionId: string;
  projectPath?: string;
  memoryContext?: unknown;
}

// ---- Tool Metadata ----
export interface ToolMeta {
  name: string;
  status: 'running' | 'done' | 'error';
  argSummary: string;
  resultSummary?: string;
  sources?: Array<{ title: string; url: string }>;
  rawOutput?: string;
}

// ---- Event Meta (for Memory/Evolution SSE events) ----
export interface MemoryRecallMeta {
  type: 'memory_recall';
  count: number;
  memories: Array<{ id: string; content: string; category: string; source: string; staleness?: string }>;
}

export interface SkillReviewMeta {
  type: 'skill_review';
  skill: { id: string; name: string; description: string; status: string };
}

export interface ToolApprovalMeta {
  type: 'tool_approval';
  approvalId: string;
  toolCallId: string;
  toolName: string;
  path: string;
  contentPreview: string;
  unifiedDiff?: string;
  bytes: number;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
}

export interface EvolutionEventMeta {
  type: 'evolution_event';
  event: string;
  detail?: string;
}

export type EventMeta = MemoryRecallMeta | SkillReviewMeta | EvolutionEventMeta | ToolApprovalMeta;

// ---- Message ----
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  toolMeta?: ToolMeta;
  eventMeta?: EventMeta;
  timestamp: number;
}

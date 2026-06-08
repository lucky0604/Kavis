// ---- Messages ----
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  timestamp: number;
}

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
}

// ---- AI Adapter ----
export type StreamEventType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'done';

export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

// ---- Agent System ----
export type CapabilityCategory = 'coding' | 'docs' | 'analysis' | 'testing' | 'file_ops' | 'ops';

export interface AgentCapability {
  category: CapabilityCategory;
  level: 1 | 2 | 3 | 4 | 5;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  capabilities: AgentCapability[];
  iconKey?: string;
  status?: 'active' | 'coming_soon';
}

// ---- Session ----
export interface SessionMeta {
  sessionId: string;
  name: string;
  agentType: string;
  createdAt: string;
  lastActiveAt: string;
  turnCount: number;
  messageCount: number;
}

export interface DialogTurn {
  turnId: string;
  turnIndex: number;
  messages: Message[];
  startTime: string;
  endTime?: string;
}

// ---- SSE Event from server ----
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
  reason: 'complete' | 'max_rounds' | 'loop_detected' | 'cancelled' | 'error';
}

// ---- Messages ----
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

export interface EvolutionEventMeta {
  type: 'evolution_event';
  event: string;
  detail?: string;
}

export type EventMeta = MemoryRecallMeta | SkillReviewMeta | EvolutionEventMeta;

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
  projectPath?: string;  // For memory scoping (optional)
  memoryContext?: unknown;  // Server-only MemoryContext — typed as unknown here, cast in server
}

// ---- AI Adapter ----
export type StreamEventType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'memory_recall'    // Memory recall notification
  | 'skill_review'     // Skill review request
  | 'evolution_event'  // Evolution event
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

// ---- Operating Mode + Agent Role (two-dimensional architecture) ----

export type OperatingModeId = 'work' | 'code';
export type AgentRoleId = 'agentic' | 'plan' | 'ask' | 'debug';

export interface ModeCapability {
  category: string;
}

export interface ModeDefinition {
  id: OperatingModeId;
  name: string;
  description: string;
  tools: string[];
  capabilities: ModeCapability[];
  iconKey: string;
}

export interface RoleDefinition {
  id: AgentRoleId;
  name: string;
  description: string;
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

// ---- Memory System (Frontend-visible types) ----

export interface MemoryEntry {
  id: string;
  content: string;
  category: 'fact' | 'preference' | 'procedure' | 'pattern' | 'context';
  source: 'MEMORY.md' | 'daily_log' | 'conversation';
  createdAt: string;
  staleness?: string;  // e.g. "47 days ago"
}

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// ---- Code Mode: External CLI Relay ----

export type CliToolId = 'claudecode' | 'opencode' | 'codex';

export interface HandoffTodo {
  text: string;
  completed: boolean;
}

export interface HandoffContext {
  sessionId: string;
  projectPath: string;
  previousCli: CliToolId;
  nextCli: CliToolId;
  todos: HandoffTodo[];
  stashHash: string | null;
  commitSha: string;
  timestamp: string;
  version: 1;
}

export interface CliToolConfig {
  id: CliToolId;
  binaryName: string;
  displayName: string;
  subCommand?: string;
  defaultModels: string[];
  capabilities: {
    streamJson: boolean;
    ptyRequired: boolean;
    supportsModels: boolean;
  };
}

export interface CliDetectionResult {
  id: CliToolId;
  displayName: string;
  available: boolean;
  binaryPath: string | null;
  models: string[];
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

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

export interface ToolApprovalMeta {
  type: 'tool_approval';
  approvalId: string;
  toolCallId: string;
  toolName: string;
  path: string;
  contentPreview: string;
  bytes: number;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
}

export interface EvolutionEventMeta {
  type: 'evolution_event';
  event: string;
  detail?: string;
}

export type EventMeta = MemoryRecallMeta | SkillReviewMeta | EvolutionEventMeta | ToolApprovalMeta;

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
  | 'approval_required'
  | 'approval_resolved'
  | 'error'
  | 'done';

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
  | { type: 'error'; data: StreamErrorEventData }
  | { type: 'done'; data: SSEDone & { messages?: Message[] } };

/**
 * Structured error payload for stream 'error' events.
 * Cross-cuts server agent-loop, prod.ts, and client chat-store — keep shape stable.
 */
export interface StreamErrorEventData {
  message: string;
  kind?: 'upstream' | 'auth' | 'rate_limit' | 'cancelled' | 'unknown';
  status?: number;
  /** Sanitized base URL — credentials MUST be stripped before assignment. */
  baseUrl?: string;
  model?: string;
  code?: string;
  /** Truncated to first 3 lines for diagnostic display. */
  stack?: string;
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
/** CLI relay sessions in Code Mode scene (distinct from Work Mode chat sessions). */
export const CODE_MODE_SESSION_AGENT = 'code-mode';

export type SessionListScope = 'work' | 'code-mode';

export function sessionMatchesScope(agentType: string, scope: SessionListScope): boolean {
  if (scope === 'code-mode') return agentType === CODE_MODE_SESSION_AGENT;
  return agentType !== CODE_MODE_SESSION_AGENT;
}

export interface SessionMeta {
  sessionId: string;
  name: string;
  agentType: string;
  createdAt: string;
  lastActiveAt: string;
  turnCount: number;
  messageCount: number;
  projectPath?: string;
  /** Name provenance: 'placeholder'|'snippet' upgradeable; 'llm'|'manual' terminal. */
  nameSource?: 'placeholder' | 'snippet' | 'llm' | 'manual';
}

// ---- Project Management ----
export interface ProjectMeta {
  id: string;
  name: string;
  path: string;
  gitBranch?: string;
  isGitClean?: boolean;
  lastAccessedAt: string;
  createdAt: string;
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
  /** Preferred model for this CLI (from local config when detectable). */
  defaultModel?: string;
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
}

export interface SSEApprovalResolved {
  id: string;
  approved: boolean;
}

/**
 * Custom Coding Agent Native Loop State Machine Reference.
 *
 * Phase 1 MVP: implemented in query.ts with HookManager lifecycle hooks.
 * This file documents the state machine transitions for reference.
 *
 * State Machine Transition:
 *   [Idle] -> [Streaming] (streamChat text_deltas)
 *             |
 *             +---> [AwaitingApproval] (patch_file tool call detected -> waitForToolApproval)
 *             |        |
 *             |        +---(Approved)---> [ExecutingTool] (apply patch -> writeFile)
 *             |        |
 *             |        +---(Denied)-----> [Streaming] (return tool error to LLM)
 *             |
 *             +---> [Done] (no more tool calls -> saveSession -> exit)
 */

export const CUSTOM_AGENT_STATE = {
  IDLE: 'idle',
  STREAMING: 'streaming',
  AWAITING_APPROVAL: 'awaiting_approval',
  EXECUTING_TOOL: 'executing_tool',
  DONE: 'done',
} as const;

/**
 * Custom Coding Agent Native Loop State Machine Reference.
 *
 * In Phase A, we delegate executeCustomAgentTurn to the core executeDialogTurn
 * to keep the implementation DRY and reuse the robust, battle-tested memory,
 * loop detection, and stream-handling infrastructure.
 *
 * If future iterations require a completely decoupled loop (e.g., running in a
 * sandboxed Docker container with custom memory systems), this file serves as the
 * blueprint for the custom state machine.
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

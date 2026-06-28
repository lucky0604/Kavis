/**
 * Nudge Engine — Adaptive periodic self-reflection
 *
 * Determines when to trigger self-evolution based on conversation
 * complexity. Simple tasks get nudged less frequently, complex
 * tasks more often.
 *
 * Frequency:
 * - Simple tasks (read, list): every 15-20 turns
 * - Medium tasks (edit, search): every 10-12 turns
 * - Complex tasks (architect, debug): every 6-8 turns
 */

import type { Message } from '../../../shared/types';

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface NudgeConfig {
  /** Override default thresholds */
  thresholds?: {
    simple: number;
    medium: number;
    complex: number;
  };
}

const DEFAULT_THRESHOLDS: Record<TaskComplexity, number> = {
  simple: 18,
  medium: 11,
  complex: 7,
};

// Tools that indicate task complexity
const SIMPLE_TOOLS = new Set(['read_file', 'list_dir_tree', 'search_content']);
const COMPLEX_TOOLS = new Set(['shell_exec', 'write_file', 'git_ops']);

export class NudgeEngine {
  private turnCount = 0;
  private thresholds: Record<TaskComplexity, number>;
  private lastNudgeTurn = 0;

  constructor(config?: NudgeConfig) {
    this.thresholds = config?.thresholds ?? DEFAULT_THRESHOLDS;
  }

  /**
   * Record a turn and check if a nudge should be triggered.
   * Returns true if it's time for a self-reflection nudge.
   */
  checkNudge(messages: Message[]): boolean {
    this.turnCount++;

    const complexity = this.assessComplexity(messages);
    const threshold = this.thresholds[complexity];
    const turnsSinceLastNudge = this.turnCount - this.lastNudgeTurn;

    if (turnsSinceLastNudge >= threshold) {
      this.lastNudgeTurn = this.turnCount;
      return true;
    }

    return false;
  }

  /**
   * Assess the complexity of recent conversation based on
   * tool usage patterns.
   */
  assessComplexity(messages: Message[]): TaskComplexity {
    // Look at recent messages (last 6 turns)
    const recent = messages.slice(-12);
    let simpleCount = 0;
    let complexCount = 0;

    for (const msg of recent) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (SIMPLE_TOOLS.has(tc.name)) simpleCount++;
          if (COMPLEX_TOOLS.has(tc.name)) complexCount++;
        }
      }
    }

    if (complexCount > simpleCount && complexCount >= 2) return 'complex';
    if (simpleCount > complexCount && simpleCount >= 3) return 'simple';
    return 'medium';
  }

  /**
   * Get the nudge prompt for self-reflection.
   */
  getNudgePrompt(complexity: TaskComplexity): string {
    const prompts: Record<TaskComplexity, string> = {
      simple: `Self-reflection check: You've been doing simple lookups. Any patterns or improvements worth noting? Consider if any repeated operations could become a skill.`,
      medium: `Self-reflection check: You've been doing moderate tasks. Are there any recurring workflows that could be streamlined? Any code patterns or preferences worth remembering?`,
      complex: `Self-reflection check: You've been working on complex tasks. Take a moment to: 1) Note any key decisions made, 2) Identify patterns in the problem-solving approach, 3) Consider if any tool sequences could become a reusable skill.`,
    };
    return prompts[complexity];
  }

  /**
   * Reset nudge state (e.g., for a new session).
   */
  reset(): void {
    this.turnCount = 0;
    this.lastNudgeTurn = 0;
  }

  get currentTurnCount(): number {
    return this.turnCount;
  }
}

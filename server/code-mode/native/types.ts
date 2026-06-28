import type { ToolDefinition } from '../../../shared/types';
import type { ExecutionConfig } from '../../work-mode/agent-loop';
import type { TaskManager } from './tasks/task-manager';

export const DEFAULT_MAX_SUBAGENT_DEPTH = 2;

/** Context passed through tool dispatch for native Code Mode (subagents, depth). */
export interface CodeModeDispatchContext {
  config: ExecutionConfig;
  toolDefs: { name: string; description: string; parameters: ToolDefinition['parameters'] }[];
  subagentDepth: number;
  taskManager: TaskManager;
  signal?: AbortSignal;
}

export function getSubagentToolNames(
  depth: number,
  maxDepth: number,
): string[] {
  const base = ['read_file', 'shell_exec', 'git_status', 'git_diff'];
  if (depth + 1 < maxDepth) {
    return [...base, 'delegate_task'];
  }
  return base;
}

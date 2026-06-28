import type { Message, ToolResult } from '../../../../shared/types';
import { toolRegistry } from '../../../shared/tools/registry';
import { HookManager } from '../hooks/hook-manager';
import { registerDefaultHooks } from '../hooks/default-hooks';
import {
  DEFAULT_MAX_SUBAGENT_DEPTH,
  getSubagentToolNames,
  type CodeModeDispatchContext,
} from '../types';
import { TaskManager } from '../tasks/task-manager';

export function registerDelegateTaskTool(): void {
  if (toolRegistry.get('delegate_task')) return;

  toolRegistry.register({
    name: 'delegate_task',
    description:
      'Delegate a focused subtask to a specialized subagent with isolated context. ' +
      'Use for research, analysis, or parallelizable work. Returns the subagent summary.',
    parameters: {
      type: 'object',
      properties: {
        taskDescription: {
          type: 'string',
          description: 'Clear, self-contained description of what the subagent should accomplish',
        },
        targetPath: {
          type: 'string',
          description: 'Optional file or directory path to focus on',
        },
      },
      required: ['taskDescription'],
    },
    execute: async (args, context): Promise<ToolResult> => {
      const codeMode = (context.memoryContext as { codeMode?: CodeModeDispatchContext } | undefined)
        ?.codeMode;
      if (!codeMode) {
        return { success: false, error: 'delegate_task is only available in native Code Mode' };
      }
      return runSubagent(args, codeMode);
    },
  });
}

async function runSubagent(
  args: Record<string, unknown>,
  parentCtx: CodeModeDispatchContext,
): Promise<ToolResult> {
  const taskDescription = String(args.taskDescription ?? '').trim();
  if (!taskDescription) {
    return { success: false, error: 'taskDescription is required' };
  }

  const targetPath = args.targetPath ? String(args.targetPath) : undefined;
  const maxDepth = parentCtx.config.maxSubagentDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH;
  const nextDepth = parentCtx.subagentDepth + 1;

  if (nextDepth > maxDepth) {
    return {
      success: false,
      error: `Max subagent depth (${maxDepth}) exceeded`,
    };
  }

  const taskManager = parentCtx.taskManager ?? new TaskManager();
  const taskId = taskManager.createTask({ taskDescription, targetPath, depth: nextDepth });

  const allowedNames = new Set(getSubagentToolNames(nextDepth, maxDepth));
  const subToolDefs = parentCtx.toolDefs.filter((t) => allowedNames.has(t.name));

  const userContent = targetPath
    ? `Task: ${taskDescription}\n\nFocus on: ${targetPath}`
    : `Task: ${taskDescription}`;

  const subMessages: Message[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    },
  ];

  const subHookManager = new HookManager();
  registerDefaultHooks(subHookManager);

  const subConfig = {
    ...parentCtx.config,
    sessionId: `${parentCtx.config.sessionId}:sub:${taskId.slice(0, 8)}`,
    maxRounds: Math.min(parentCtx.config.maxRounds, 15),
    subagentDepth: nextDepth,
  };

  const { query } = await import('../query');

  let resultText = '';
  let stopReason = 'complete';
  let failed = false;

  try {
    for await (const event of query(subMessages, subToolDefs, subConfig, subHookManager, parentCtx.signal)) {
      if (event.type === 'text_delta') {
        resultText += (event.data as { text: string }).text;
      }
      if (event.type === 'error') {
        failed = true;
        resultText = (event.data as { message: string }).message;
        break;
      }
      if (event.type === 'done') {
        stopReason = (event.data as { reason: string }).reason;
        if (stopReason !== 'complete') failed = true;
      }
    }
  } catch (err) {
    failed = true;
    const msg = err instanceof Error ? err.message : String(err);
    taskManager.failTask(taskId, msg);
    return { success: false, error: msg };
  }

  const summary = resultText.trim() || `(Subagent finished: ${stopReason})`;
  if (failed) {
    taskManager.failTask(taskId, summary);
    return { success: false, error: summary };
  }

  taskManager.completeTask(taskId, summary);
  return {
    success: true,
    data: {
      taskId,
      depth: nextDepth,
      stopReason,
      output: summary,
      tasks: taskManager.listTasks(),
    },
  };
}

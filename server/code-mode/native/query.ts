import type { Message, ToolCall, ToolDefinition } from '../../../shared/types';
import type { StreamEvent } from '../../shared/ai/adapter';
import { OpenAIAdapter } from '../../shared/ai/openai-adapter';
import { LoopDetector } from '../../work-mode/loop-detector';
import { ContextCompressor } from '../../work-mode/context-compressor';
import { CancellationToken } from '../../work-mode/cancellation';
import { dispatchToolCalls } from '../../work-mode/tool-dispatcher';
import { handleStreamError, buildSystemContent, performMemoryRecall } from '../../work-mode/message-handler';
import type { ExecutionConfig } from '../../work-mode/agent-loop';
import { initMemoryContext, loadResidentMemory, SessionMemory } from '../../shared/memory/index';
import { HookManager } from './hooks/hook-manager';
import {
  hasProjectRulesMessage,
  projectRulesMarker,
  readProjectRules,
  upsertProjectRulesMessage,
} from './memory/agents-md-reader';
import { RulesWatcher } from './memory/rules-watcher';
import { applyHookResult, runHookPipeline, triggerOnStop } from './query-helpers';
import { TaskManager } from './tasks/task-manager';
import type { CodeModeDispatchContext } from './types';

async function consumeHookPipeline(
  hookManager: HookManager,
  hookType: Parameters<typeof runHookPipeline>[1],
  context: Parameters<typeof runHookPipeline>[2],
): Promise<{ events: StreamEvent[]; result: Awaited<ReturnType<HookManager['executePipeline']>> }> {
  const events: StreamEvent[] = [];
  const gen = runHookPipeline(hookManager, hookType, context);
  while (true) {
    const step = await gen.next();
    if (step.done) return { events, result: step.value };
    events.push(step.value);
  }
}

export async function* query(
  messages: Message[],
  toolDefs: { name: string; description: string; parameters: ToolDefinition['parameters'] }[],
  config: ExecutionConfig,
  hookManager: HookManager,
  signal?: AbortSignal,
  taskManager?: TaskManager,
): AsyncGenerator<StreamEvent> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    yield { type: 'error', data: { message: 'OpenAI API key not configured' } };
    return;
  }

  const adapter = new OpenAIAdapter(apiKey, config.baseUrl);
  const effectiveModel = config.modelName?.trim() || process.env.OPENAI_MODEL || 'gpt-4o';
  const detector = new LoopDetector();
  const compressor = new ContextCompressor({ modelMaxTokens: config.modelMaxTokens });
  const canceller = new CancellationToken();
  let round = 0;
  let messagesArr = [...messages];

  const memCtx = initMemoryContext(config.workspacePath, config.sessionId);
  const sessionMemory = new SessionMemory(memCtx);
  const residentMemory = loadResidentMemory(memCtx);
  const rulesWatcher = new RulesWatcher(config.workspacePath);
  const subagentDepth = config.subagentDepth ?? 0;
  const manager = taskManager ?? new TaskManager();

  const codeModeCtx: CodeModeDispatchContext = {
    config,
    toolDefs,
    subagentDepth,
    taskManager: manager,
    signal,
  };

  const projectRules = await readProjectRules(config.workspacePath);
  if (!messagesArr.some((m) => m.role === 'system')) {
    const basePrompt = config.systemPrompt?.trim() || 'You are Kavis Code, an AI coding assistant.';
    let systemContent = buildSystemContent(config, residentMemory, basePrompt);
    if (projectRules) {
      systemContent += `\n\n${projectRulesMarker()}\n${projectRules}`;
    }
    messagesArr.unshift({
      id: crypto.randomUUID(),
      role: 'system',
      content: systemContent,
      timestamp: Date.now(),
    });
  } else if (projectRules && !messagesArr.some((m) => hasProjectRulesMessage(m.content))) {
    messagesArr = upsertProjectRulesMessage(messagesArr, projectRules);
  }
  await rulesWatcher.sync();

  if (signal) {
    signal.addEventListener('abort', () => canceller.cancel(), { once: true });
  }

  while (round < config.maxRounds) {
    canceller.throwIfCancelled();

    const rulesUpdate = await rulesWatcher.checkForUpdate();
    if (rulesUpdate.changed) {
      messagesArr = upsertProjectRulesMessage(messagesArr, rulesUpdate.rules);
      yield {
        type: 'hook_event',
        data: {
          hookType: 'project-rules-reload',
          status: 'rewrite',
          round,
          detail: rulesUpdate.rules ? 'Project rules reloaded' : 'Project rules removed',
        },
      };
    }

    yield* performMemoryRecall(messagesArr, round, sessionMemory, memCtx);

    if (compressor.shouldCompress(messagesArr)) {
      sessionMemory.flush();
      messagesArr = compressor.compress(messagesArr);
      yield { type: 'text_delta', data: { text: '\n[Context compressed]\n' } };
    }

    const preModel = await consumeHookPipeline(hookManager, 'pre-model', {
      messages: messagesArr,
      currentRound: round,
      metadata: {},
    });
    yield* preModel.events;
    const preModelApplied = applyHookResult(preModel.result, messagesArr);
    if (preModelApplied.abort) {
      yield* triggerOnStop(hookManager, preModelApplied.messages, round, preModelApplied.reason ?? 'hook_abort');
      return;
    }
    messagesArr = preModelApplied.messages;

    let textContent = '';
    let hasText = false;
    const toolCalls: ToolCall[] = [];

    try {
      for await (const event of adapter.streamChat(messagesArr, toolDefs, effectiveModel, canceller.signal)) {
        canceller.throwIfCancelled();
        if (event.type === 'text_delta') {
          textContent += (event.data as { text: string }).text;
          hasText = true;
          yield event;
        }
        if (event.type === 'tool_call') {
          const tc = event.data as { id: string; name: string; arguments: string };
          toolCalls.push({ id: tc.id, name: tc.name, arguments: JSON.parse(tc.arguments || '{}') });
          yield event;
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError')) {
        yield* triggerOnStop(hookManager, messagesArr, round, 'cancelled');
        return;
      }
      yield { type: 'error', data: handleStreamError(err, effectiveModel) };
      yield* triggerOnStop(hookManager, messagesArr, round, 'error');
      return;
    }

    const postModel = await consumeHookPipeline(hookManager, 'post-model', {
      messages: messagesArr,
      currentRound: round,
      toolCalls,
      metadata: { textContent },
    });
    yield* postModel.events;
    const postModelApplied = applyHookResult(postModel.result, messagesArr);
    if (postModelApplied.abort) {
      yield* triggerOnStop(hookManager, postModelApplied.messages, round, postModelApplied.reason ?? 'hook_abort');
      return;
    }
    messagesArr = postModelApplied.messages;

    if (toolCalls.length === 0) {
      messagesArr.push({ id: crypto.randomUUID(), role: 'assistant', content: textContent, timestamp: Date.now() });
      if (textContent.length > 20) {
        sessionMemory.observe(`Assistant: ${textContent.slice(0, 500)}`);
      }
      sessionMemory.flush();
      yield* triggerOnStop(hookManager, messagesArr, round, 'complete');
      return;
    }

    if (hasText) detector.resetOnText();
    if (!hasText) {
      const { loopDetected } = detector.detect(toolCalls);
      if (loopDetected) {
        messagesArr.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: 'Loop detected. Try a different approach.',
          timestamp: Date.now(),
        });
        if (detector.shouldTerminate()) {
          yield* triggerOnStop(hookManager, messagesArr, round, 'loop_detected');
          return;
        }
      }
    }

    messagesArr.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: textContent,
      toolCalls,
      timestamp: Date.now(),
    });

    const preTool = await consumeHookPipeline(hookManager, 'pre-tool', {
      messages: messagesArr,
      currentRound: round,
      toolCalls,
      metadata: {},
    });
    yield* preTool.events;
    const preToolApplied = applyHookResult(preTool.result, messagesArr);
    if (preToolApplied.abort) {
      yield* triggerOnStop(
        hookManager,
        preToolApplied.messages,
        round,
        preToolApplied.reason ?? 'security_blocked',
      );
      return;
    }
    messagesArr = preToolApplied.messages;

    yield* dispatchToolCalls(
      toolCalls,
      config,
      messagesArr,
      sessionMemory,
      memCtx,
      canceller,
      signal,
      codeModeCtx,
    );

    const postTool = await consumeHookPipeline(hookManager, 'post-tool', {
      messages: messagesArr,
      currentRound: round,
      toolCalls,
      metadata: {},
    });
    yield* postTool.events;
    const postToolApplied = applyHookResult(postTool.result, messagesArr);
    if (postToolApplied.abort) {
      yield* triggerOnStop(hookManager, postToolApplied.messages, round, postToolApplied.reason ?? 'hook_abort');
      return;
    }
    messagesArr = postToolApplied.messages;

    round++;
  }

  yield* triggerOnStop(hookManager, messagesArr, round, 'max_rounds');
}
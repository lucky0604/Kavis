import type { Message, ToolCall, ToolDefinition } from '../../shared/types';
import { OpenAIAdapter } from '../ai/openai-adapter';
import type { StreamEvent } from '../ai/adapter';
import { toolRegistry } from '../tools/registry';
import { LoopDetector } from './loop-detector';
import { ContextCompressor } from './context-compressor';
import { CancellationToken } from './cancellation';

const SYSTEM_PROMPT = `You are Janus, an AI workspace assistant. You help users analyze, understand, and work with their local project files.

## Your Capabilities
- Read and write files
- List directory contents and generate project trees
- Search code for patterns and references
- Execute shell commands (with safety limits)
- Query git status and show diffs

## Rules
- Always use tools to get accurate information
- Be concise and specific — name real files, functions, line numbers
- If a tool fails, try an alternative approach
- Never make up file contents — always check with tools first

## Output Style
- Use Markdown for formatting
- Code references should use backticks
- Keep responses focused and actionable`;

export interface ExecutionConfig {
  maxRounds: number;
  workspacePath: string;
  sessionId: string;
  apiKey: string;
  modelMaxTokens?: number;
  baseUrl?: string;
  modelName?: string;
}

export async function* executeDialogTurn(
  messages: Message[],
  toolDefs: { name: string; description: string; parameters: ToolDefinition['parameters'] }[],
  config: ExecutionConfig,
  signal?: AbortSignal
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
  let rounds = 0;
  let messagesArr = [...messages];

  if (!messagesArr.some((m) => m.role === 'system')) {
    messagesArr.unshift({
      id: crypto.randomUUID(),
      role: 'system',
      content: SYSTEM_PROMPT,
      timestamp: Date.now(),
    });
  }

  if (signal) {
    signal.addEventListener('abort', () => canceller.cancel(), { once: true });
  }

  while (rounds < config.maxRounds) {
    canceller.throwIfCancelled();

    if (compressor.shouldCompress(messagesArr)) {
      messagesArr = compressor.compress(messagesArr);
      yield { type: 'text_delta', data: { text: '\n[Context compressed]\n' } };
    }

    let textContent = '';
    let hasText = false;
    const toolCalls: ToolCall[] = [];

    try {
      // toolDefs.parameters is already a valid JSON Schema object — pass through directly
      const adaptedTools = toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

      for await (const event of adapter.streamChat(messagesArr, adaptedTools, effectiveModel, canceller.signal)) {
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
      if (err instanceof Error && err.name === 'CancelledError') {
        yield { type: 'done', data: { reason: 'cancelled' } };
        return;
      }
      yield { type: 'error', data: { message: err instanceof Error ? err.message : 'AI call failed' } };
      return;
    }

    if (hasText) detector.resetOnText();

    if (toolCalls.length === 0) {
      messagesArr.push({ id: crypto.randomUUID(), role: 'assistant', content: textContent, timestamp: Date.now() });
      yield { type: 'done', data: { reason: 'complete' } };
      return;
    }

    // Only detect loops when AI hasn't produced meaningful text
    if (!hasText) {
      const { loopDetected } = detector.detect(toolCalls);
      if (loopDetected) {
        messagesArr.push({ id: crypto.randomUUID(), role: 'system', content: 'Loop detected. Try a different approach.', timestamp: Date.now() });
        if (detector.shouldTerminate()) {
          yield { type: 'done', data: { reason: 'loop_detected' } };
          return;
        }
      }
    }

    messagesArr.push({ id: crypto.randomUUID(), role: 'assistant', content: textContent, toolCalls, timestamp: Date.now() });

    for (const tc of toolCalls) {
      canceller.throwIfCancelled();
      try {
        const result = await toolRegistry.execute(tc.name, tc.arguments, { workspacePath: config.workspacePath, sessionId: config.sessionId });
        const output = result.success ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)) : `Error: ${result.error}`;
        messagesArr.push({ id: crypto.randomUUID(), role: 'tool', content: output, toolCallId: tc.id, timestamp: Date.now() });
        yield { type: 'tool_result', data: { id: tc.id, name: tc.name, success: result.success, output } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool failed';
        messagesArr.push({ id: crypto.randomUUID(), role: 'tool', content: `Error: ${msg}`, toolCallId: tc.id, timestamp: Date.now() });
        yield { type: 'tool_result', data: { id: tc.id, name: tc.name, success: false, output: msg } };
      }
    }
    rounds++;
  }
  yield { type: 'done', data: { reason: 'max_rounds' } };
}

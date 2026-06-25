import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Message, ToolCall, ToolDefinition } from '../../shared/types';
import { OpenAIAdapter, AuthError, RateLimitError, UpstreamStreamError } from '../ai/openai-adapter';
import type { StreamEvent } from '../ai/adapter';
import { toolRegistry } from '../tools/registry';
import { LoopDetector } from './loop-detector';
import { ContextCompressor } from './context-compressor';
import { CancellationToken } from './cancellation';
import { initMemoryContext, loadResidentMemory, SessionMemory, recallMemories, formatRecalledMemories } from '../memory/index';
import { NudgeEngine } from '../evolution/nudge-engine';
import { PatternDetector } from '../evolution/pattern-detector';
import { craftSkill } from '../evolution/skill-crafter';
import { submitManyForReview, getPendingReviews } from '../evolution/skill-review';
import { createApprovalId, waitForToolApproval } from './tool-approval';
import { optionalWorkspaceRoot, workspacePromptBlock, noWorkspacePromptBlock } from '../tools/workspace-context';

const APPROVAL_REQUIRED_TOOLS = new Set(['write_file']);

const DEFAULT_SYSTEM_PROMPT = `You are Janus, an AI workspace assistant. You help users analyze, understand, and work with their local project files.

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
  systemPrompt?: string;
}

/**
 * Load system prompt from a markdown file, falling back to the default.
 */
function loadPromptFromFile(relativePath: string): string | null {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(__dirname, relativePath);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Resolve the effective system prompt:
 * 1. Explicit config.systemPrompt
 * 2. Prompt file at agents/prompts/work-mode.md
 * 3. DEFAULT_SYSTEM_PROMPT fallback
 */
function resolveSystemPrompt(config: ExecutionConfig): string {
  if (config.systemPrompt) return config.systemPrompt;
  const filePrompt = loadPromptFromFile('../agents/prompts/work-mode.md');
  if (filePrompt) return filePrompt;
  return DEFAULT_SYSTEM_PROMPT;
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

  // ---- Memory System Integration ----
  const memCtx = initMemoryContext(config.workspacePath, config.sessionId);
  const sessionMemory = new SessionMemory(memCtx);
  const residentMemory = loadResidentMemory(memCtx);
  const nudgeEngine = new NudgeEngine();
  const patternDetector = new PatternDetector();
  const janusDir = path.dirname(memCtx.persistentPath);

  if (!messagesArr.some((m) => m.role === 'system')) {
    // Layer 1: Inject resident memory into system prompt
    const basePrompt = resolveSystemPrompt(config);
    const wsRoot = optionalWorkspaceRoot(config.workspacePath);
    const pathBlock = wsRoot
      ? `\n\n${workspacePromptBlock(wsRoot)}`
      : `\n\n${noWorkspacePromptBlock()}`;
    const systemContent = residentMemory
      ? `${basePrompt}${pathBlock}\n\n${residentMemory}`
      : `${basePrompt}${pathBlock}`;

    messagesArr.unshift({
      id: crypto.randomUUID(),
      role: 'system',
      content: systemContent,
      timestamp: Date.now(),
    });
  }

  if (signal) {
    signal.addEventListener('abort', () => canceller.cancel(), { once: true });
  }

  while (rounds < config.maxRounds) {
    canceller.throwIfCancelled();

    // ---- Layer 2: Per-Turn Memory Recall ----
    const lastUserMsg = messagesArr.filter((m) => m.role === 'user').at(-1);
    if (lastUserMsg) {
      // ---- Memory: Observe user message ----
      sessionMemory.observe(`User: ${lastUserMsg.content.slice(0, 300)}`);
    }
    if (lastUserMsg && rounds > 0) {
      const recalled = recallMemories(lastUserMsg.content, memCtx);
      if (recalled.length > 0) {
        const recallText = formatRecalledMemories(recalled);
        // Inject as system message before this turn
        messagesArr.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: recallText,
          timestamp: Date.now(),
        });
        // Notify frontend
        yield { type: 'memory_recall', data: { count: recalled.length, memories: recalled } };
      }
    }

    if (compressor.shouldCompress(messagesArr)) {
      // ---- Layer 3 trigger: Flush observations before compression ----
      sessionMemory.flush();

      messagesArr = compressor.compress(messagesArr);
      yield { type: 'text_delta', data: { text: '\n[Context compressed]\n' } };
    }

    let textContent = '';
    let hasText = false;
    const toolCalls: ToolCall[] = [];

    try {
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
        yield { type: 'done', data: { reason: 'cancelled', messages: messagesArr } };
        return;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'done', data: { reason: 'cancelled', messages: messagesArr } };
        return;
      }

      const errorData: {
        message: string;
        kind: 'upstream' | 'auth' | 'rate_limit' | 'cancelled' | 'unknown';
        status?: number;
        baseUrl?: string;
        model?: string;
        code?: string;
        stack?: string;
      } = {
        message: err instanceof Error ? err.message : 'AI call failed',
        kind: 'unknown',
        model: effectiveModel,
      };

      if (err instanceof UpstreamStreamError) {
        errorData.kind = 'upstream';
        errorData.status = err.status;
        errorData.baseUrl = err.baseUrl;
        errorData.model = err.model;
        errorData.code = err.code;
      } else if (err instanceof AuthError) {
        errorData.kind = 'auth';
      } else if (err instanceof RateLimitError) {
        errorData.kind = 'rate_limit';
      }

      if (err instanceof Error && err.stack) {
        errorData.stack = err.stack.split('\n').slice(0, 3).join('\n');
      }

      console.error('[agent-loop] stream error:', {
        kind: errorData.kind,
        status: errorData.status,
        baseUrl: errorData.baseUrl,
        model: errorData.model,
        code: errorData.code,
        message: errorData.message,
        cause: err instanceof UpstreamStreamError ? err.cause : undefined,
      });

      yield { type: 'error', data: errorData };
      return;
    }

    if (hasText) detector.resetOnText();

    if (toolCalls.length === 0) {
      messagesArr.push({ id: crypto.randomUUID(), role: 'assistant', content: textContent, timestamp: Date.now() });

      // ---- Memory: Observe final assistant response, then flush ----
      if (textContent.length > 20) {
        sessionMemory.observe(`Assistant: ${textContent.slice(0, 500)}`);
      }
      sessionMemory.flush();

      yield { type: 'done', data: { reason: 'complete', messages: messagesArr } };
      return;
    }

    // Only detect loops when AI hasn't produced meaningful text
    if (!hasText) {
      const { loopDetected } = detector.detect(toolCalls);
      if (loopDetected) {
        messagesArr.push({ id: crypto.randomUUID(), role: 'system', content: 'Loop detected. Try a different approach.', timestamp: Date.now() });
        if (detector.shouldTerminate()) {
          yield { type: 'done', data: { reason: 'loop_detected', messages: messagesArr } };
          return;
        }
      }
    }

    messagesArr.push({ id: crypto.randomUUID(), role: 'assistant', content: textContent, toolCalls, timestamp: Date.now() });

    for (const tc of toolCalls) {
      canceller.throwIfCancelled();
      try {
        let approved = true;
        if (APPROVAL_REQUIRED_TOOLS.has(tc.name)) {
          const approvalId = createApprovalId();
          const filePath = String(tc.arguments.path ?? '');
          const content = String(tc.arguments.content ?? '');
          const bytes = Buffer.byteLength(content, 'utf-8');

          yield {
            type: 'approval_required',
            data: {
              id: approvalId,
              toolCallId: tc.id,
              name: tc.name,
              path: filePath,
              contentPreview: content.slice(0, 800),
              bytes,
            },
          };

          approved = await waitForToolApproval(approvalId, 10 * 60 * 1000, signal);
          if (signal?.aborted) return;
          yield {
            type: 'approval_resolved',
            data: { id: approvalId, approved },
          };
        }

        if (!approved) {
          const output = `Error: User denied write permission for ${String(tc.arguments.path ?? 'file')}`;
          messagesArr.push({
            id: crypto.randomUUID(),
            role: 'tool',
            content: output,
            toolCallId: tc.id,
            timestamp: Date.now(),
          });
          yield {
            type: 'tool_result',
            data: { id: tc.id, name: tc.name, success: false, output },
          };
          sessionMemory.observe(`Tool Denied: ${tc.name} | Path: ${String(tc.arguments.path ?? '')}`);
          continue;
        }

        const result = await toolRegistry.execute(tc.name, tc.arguments, {
          workspacePath: config.workspacePath,
          sessionId: config.sessionId,
          projectPath: config.workspacePath,
          memoryContext: memCtx,
        });
        const output = result.success ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)) : `Error: ${result.error}`;
        messagesArr.push({ id: crypto.randomUUID(), role: 'tool', content: output, toolCallId: tc.id, timestamp: Date.now() });
        yield { type: 'tool_result', data: { id: tc.id, name: tc.name, success: result.success, output } };

        // ---- Memory: Observe tool usage ----
        sessionMemory.observe(`Tool: ${tc.name} | Success: ${result.success} | Args: ${JSON.stringify(tc.arguments).slice(0, 200)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool failed';
        messagesArr.push({ id: crypto.randomUUID(), role: 'tool', content: `Error: ${msg}`, toolCallId: tc.id, timestamp: Date.now() });
        yield { type: 'tool_result', data: { id: tc.id, name: tc.name, success: false, output: msg } };

        // ---- Memory: Observe tool errors ----
        sessionMemory.observe(`Tool Error: ${tc.name} | Error: ${msg}`);
      }
    }
    rounds++;

    // ---- Evolution: Adaptive self-reflection → Pattern detection → Skill crafting ----
    if (nudgeEngine.checkNudge(messagesArr)) {
      const complexity = nudgeEngine.assessComplexity(messagesArr);
      const nudgePrompt = nudgeEngine.getNudgePrompt(complexity);
      messagesArr.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: nudgePrompt,
        timestamp: Date.now(),
      });

      // Run pattern detection on the conversation so far
      const patterns = patternDetector.detect(messagesArr);
      if (patterns.length > 0) {
        // Craft skill drafts from detected patterns
        const drafts = await craftSkill(patterns, { janusDir, useEvolver: true });
        if (drafts.length > 0) {
          // Submit drafts for user review
          submitManyForReview(drafts, janusDir);

          // Notify frontend about new skill drafts
          yield {
            type: 'skill_review',
            data: {
              count: drafts.length,
              skills: drafts.map((d) => ({
                id: d.id,
                name: d.name,
                description: d.description,
                status: d.status,
              })),
            },
          };
        }
      }

      // Also check if there are pending reviews the user should see
      const pending = getPendingReviews(janusDir);
      if (pending.length > 0) {
        yield {
          type: 'skill_review',
          data: {
            count: pending.length,
            skills: pending.map((e) => ({
              id: e.skill.id,
              name: e.skill.name,
              description: e.skill.description,
              status: e.skill.status,
            })),
            message: `You have ${pending.length} skill draft(s) pending review. Use the "evolve" tool to approve or reject them.`,
          },
        };
      }
    }
  }
  yield { type: 'done', data: { reason: 'max_rounds', messages: messagesArr } };
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Message, ToolCall, ToolDefinition } from '../../shared/types';
import { OpenAIAdapter } from '../shared/ai/openai-adapter';
import type { StreamEvent } from '../shared/ai/adapter';
import { LoopDetector } from './loop-detector';
import { ContextCompressor } from './context-compressor';
import { CancellationToken } from './cancellation';
import { initMemoryContext, loadResidentMemory, SessionMemory } from '../shared/memory/index';
import { NudgeEngine } from '../shared/evolution/nudge-engine';
import { PatternDetector } from '../shared/evolution/pattern-detector';
import { craftSkill } from '../shared/evolution/skill-crafter';
import { submitManyForReview, getPendingReviews } from '../shared/evolution/skill-review';
import { dispatchToolCalls } from './tool-dispatcher';
import { handleStreamError, buildSystemContent, performMemoryRecall } from './message-handler';

const DEFAULT_SYSTEM_PROMPT = `You are Kavis, an AI workspace assistant. You help users analyze, understand, and work with their local project files.

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
  /** Current subagent nesting depth (0 = root agent). */
  subagentDepth?: number;
  /** Maximum allowed subagent recursion depth. Default: 2. */
  maxSubagentDepth?: number;
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
  const kavisHomeDir = path.dirname(memCtx.persistentPath);

  if (!messagesArr.some((m) => m.role === 'system')) {
    const basePrompt = resolveSystemPrompt(config);
    const systemContent = buildSystemContent(config, residentMemory, basePrompt);
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
    yield* performMemoryRecall(messagesArr, rounds, sessionMemory, memCtx);

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
      if (err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError')) {
        yield { type: 'done', data: { reason: 'cancelled', messages: messagesArr } };
        return;
      }
      const errorData = handleStreamError(err, effectiveModel);
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
    // ---- Tool Dispatch ----
    yield* dispatchToolCalls(toolCalls, config, messagesArr, sessionMemory, memCtx, canceller, signal);
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
        const drafts = await craftSkill(patterns, { kavisHomeDir, useEvolver: true });
        if (drafts.length > 0) {
          // Submit drafts for user review
          submitManyForReview(drafts, kavisHomeDir);
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
      const pending = getPendingReviews(kavisHomeDir);
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

import type { Message, StreamEvent, ToolDefinition, OperatingModeId, AgentRoleId } from '../../shared/types';
import { executeDialogTurn } from '../work-mode/agent-loop';
import { executeCustomAgentTurn } from '../code-mode/native/index';
import { toolRegistry } from '../shared/tools/registry';
import { agentRegistry } from '../shared/agents/registry';
import { OPERATING_MODES, compositeId } from '../shared/agents/config';
import { saveSession, loadSession, getSessionMetadata, shouldUpgradeName, updateSessionName } from '../shared/persistence/session-store';
import { generateTitle } from '../shared/persistence/title-generator';
import { logError } from '../shared/utils/error-log';
import dotenv from 'dotenv';

dotenv.config();

export interface ChatStreamRequest {
  messages: Message[];
  workspacePath: string;
  sessionId: string;
  apiKey: string;
  baseUrl?: string;
  modelName?: string;
  /** Operating mode id (work | code). */
  mode?: OperatingModeId;
  /** Agent role id (agentic | plan | ask | debug). Only used when mode=code. */
  role?: AgentRoleId;
  /* Legacy: single agentId string — kept for backward compat. */
  agentId?: string;
}

/**
 * Resolve the effective tools and system prompt from mode + role.
 *
 * Architecture:
 *   Operating Mode → decides tool set
 *   Agent Role     → decides system prompt (persona / methodology)
 *   Work Mode      → no role dimension, uses work-mode.md
 *   Code Mode      → uses code-{role}-mode.md (or code-agentic-mode.md if no role)
 */
export function resolveModeRole(
  modeId: OperatingModeId | undefined,
  roleId: AgentRoleId | undefined,
): {
  resolvedMode: OperatingModeId;
  resolvedRole: AgentRoleId | undefined;
  compositeKey: string;
  tools: ToolDefinition[];
  warnings: string[];
} {
  const warnings: string[] = [];

  // Default: Work Mode (if no mode specified)
  const resolvedMode: OperatingModeId = modeId && (modeId === 'work' || modeId === 'code')
    ? modeId
    : 'work';
  const resolvedRole = resolvedMode === 'code' ? (roleId || 'agentic') : undefined;
  const key = compositeId(resolvedMode, resolvedRole);

  // Look up the tool set from the mode definition
  const modeDef = OPERATING_MODES.find((m) => m.id === resolvedMode);
  if (!modeDef) {
    const msg = `[Kavis] Unknown mode "${resolvedMode}", falling back to "work"`;
    console.warn(msg);
    warnings.push(msg);
    const fallbackMode = OPERATING_MODES.find((m) => m.id === 'work')!;
    const allTools = toolRegistry.getAll();
    const tools = allTools.filter((t) => fallbackMode.tools.includes(t.name));
    return { resolvedMode: 'work', resolvedRole: undefined, compositeKey: 'work', tools, warnings };
  }

  // Filter tools by mode's whitelist
  const allTools = toolRegistry.getAll();
  const validNames = new Set(allTools.map((t) => t.name));
  const invalid = modeDef.tools.filter((n) => !validNames.has(n));
  if (invalid.length > 0) {
    const msg = `[Kavis] Mode "${resolvedMode}" references unknown tools: ${invalid.join(', ')}`;
    console.warn(msg);
    warnings.push(msg);
  }

  let tools = allTools.filter((t) => modeDef.tools.includes(t.name) || t.name === 'patch_file');

  if (resolvedMode === 'code' && resolvedRole === 'kavis-code') {
    const customWhitelist = new Set(['read_file', 'patch_file', 'shell_exec']);
    tools = tools.filter((t) => customWhitelist.has(t.name));
  } else {
    tools = tools.filter((t) => t.name !== 'patch_file');
  }

  return { resolvedMode, resolvedRole, compositeKey: key, tools, warnings };
}

/**
 * Resolve agent identity and tool whitelist from the registry.
 * Backward-compatible wrapper: accepts either mode+role or legacy agentId.
 */
export function resolveAgentTools(
  agentId: string | undefined,
  mode?: OperatingModeId,
  role?: AgentRoleId,
): {
  resolvedAgentId: string;
  tools: ToolDefinition[];
  warnings: string[];
} {
  // New path: mode+role provided
  if (mode) {
    const resolved = resolveModeRole(mode, role);
    const agent = agentRegistry.get(resolved.compositeKey);
    if (!agent) {
      const modeOnly = agentRegistry.get(mode);
      if (modeOnly) {
        return {
          resolvedAgentId: mode,
          tools: resolved.tools,
          warnings: resolved.warnings,
        };
      }
    }
    return {
      resolvedAgentId: resolved.compositeKey,
      tools: resolved.tools,
      warnings: resolved.warnings,
    };
  }

  // Legacy path: single agentId (backward compat)
  const warnings: string[] = [];
  const agent = agentId ? agentRegistry.get(agentId) : agentRegistry.get('work');

  if (!agent && agentId) {
    const msg = `[Kavis] Unknown agentId "${agentId}", falling back to "work"`;
    console.warn(msg);
    warnings.push(msg);
  }
  const resolvedAgent = agent || agentRegistry.get('work')!;
  const agentTools = resolvedAgent.tools;
  const allTools = toolRegistry.getAll();

  if (agentTools && agentTools.length > 0) {
    const validNames = new Set(allTools.map(t => t.name));
    const invalid = agentTools.filter(n => !validNames.has(n));
    if (invalid.length > 0) {
      const msg = `[Kavis] Agent "${resolvedAgent.id}" references unknown tools: ${invalid.join(', ')}`;
      console.warn(msg);
      warnings.push(msg);
    }
  }

  const tools = agentTools && agentTools.length > 0
    ? allTools.filter(t => agentTools.includes(t.name))
    : allTools;

  return { resolvedAgentId: resolvedAgent.id, tools, warnings };
}

/**
 * Build a ChatStreamRequest-compatible agentId from mode+role.
 * Frontend sends { mode, role } → server converts to composite key.
 */
export function makeAgentId(mode: OperatingModeId, role?: AgentRoleId): string {
  return compositeId(mode, role);
}

export async function handleChatStream(
  req: ChatStreamRequest,
  signal: AbortSignal
): Promise<ReadableStream> {
  const { messages, sessionId, workspacePath, apiKey, baseUrl, modelName, mode, role } = req;
  const resolvedPath =
    (workspacePath || '').trim() ||
    (process.env.JANUS_WORKSPACE || '').trim() ||
    process.cwd();

  // Backward compat: prefer mode+role, fall back to agentId
  let tools: ToolDefinition[];
  let resolvedAgentId: string;

  if (mode) {
    const resolved = resolveModeRole(mode, role);
    tools = resolved.tools;
    resolvedAgentId = resolved.compositeKey;
  } else {
    const resolved = resolveAgentTools(req.agentId);
    tools = resolved.tools;
    resolvedAgentId = resolved.resolvedAgentId;
  }

  const resolvedAgent = agentRegistry.get(resolvedAgentId);
  const systemPrompt = resolvedAgent?.systemPrompt || '';

  // Build the effective composite id for persistence
  const compositeKey = mode ? compositeId(mode, role || undefined) : (req.agentId || 'work');

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const toolDefs = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));

        const config = {
          maxRounds: 10,
          workspacePath: resolvedPath,
          sessionId,
          apiKey,
          baseUrl,
          modelName,
          systemPrompt,
        };

        let doneEmitted = false;

        const turnGenerator = mode === 'code' && role === 'kavis-code'
          ? executeCustomAgentTurn(messages, toolDefs, config, signal)
          : executeDialogTurn(messages, toolDefs, config, signal);

        for await (const event of turnGenerator) {
          if (signal.aborted) {
            push({ type: 'done', data: { reason: 'cancelled' } });
            doneEmitted = true;
            controller.close();
            return;
          }

          if (event.type === 'done') {
            push(event);
            doneEmitted = true;

            const doneData = event.data as { reason: string; messages?: Message[] };
            if (doneData.messages) {
              try {
                await saveSession(sessionId, doneData.messages, compositeKey, resolvedPath);

                const meta = await getSessionMetadata(sessionId);
                if (meta && shouldUpgradeName(meta) && doneData.messages.some((m) => m.role === 'assistant')) {
                  const finalMessages = doneData.messages;
                  generateTitle(finalMessages, { apiKey, baseUrl, modelName })
                    .then((title) => {
                      if (title) {
                        return updateSessionName(sessionId, title, 'llm');
                      }
                    })
                    .catch(() => {});
                }
              } catch {
                // Persistence failure should not break the stream
              }
            }
            break;
          }

          push(event);
        }

        if (!doneEmitted) {
          push({ type: 'done', data: { reason: 'complete' } });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : undefined;
        const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
        console.error('[chat-route] handler error:', { message, code, stack });
        logError({ source: 'chat-route', message, kind: 'unknown', code, stack });
        push({
          type: 'error',
          data: { message, kind: 'unknown', code, stack },
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Clean up on client disconnect
    },
  });
}

export async function handleGetMessages(sessionId: string): Promise<{ messages: Message[] }> {
  // Load from persistent session store
  const session = await loadSession(sessionId);
  if (session) {
    return { messages: session.messages };
  }
  return { messages: [] };
}
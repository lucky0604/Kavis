import type { Message, ToolDefinition } from '../../../shared/types';
import OpenAI from 'openai';

export type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Build the OpenAI-shaped message array from Kavis internal Messages.
 *
 * The Kavis UI stores many UI-only messages (event cards with empty content,
 * pending tool placeholders, [Stopped] assistant stubs from interrupted streams).
 * Sending these to the upstream provider causes strict gateways (e.g. thor WAF)
 * to RST the connection before any response header — manifesting as
 * ERR_STREAM_PREMATURE_CLOSE with chunks=0, bytes=0, elapsed≈1s.
 *
 * Rules enforced (OpenAI Chat Completions spec):
 *   - user/system: drop if content is empty after trim
 *   - assistant:  keep only if content non-empty OR has tool_calls
 *   - tool:       keep only if has toolCallId AND non-empty content
 *   - drop trailing empty assistant entirely (the streaming placeholder)
 */
export function sanitizeMessagesForUpstream(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of messages) {
    const content = (m.content || '').trim();
    const hasToolCalls = Array.isArray(m.toolCalls) && m.toolCalls.length > 0;

    if (m.role === 'tool') {
      if (!m.toolCallId || !content) continue;
      out.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId,
      });
      continue;
    }

    if (m.role === 'assistant') {
      if (!content && !hasToolCalls) continue;
      out.push({
        role: 'assistant',
        content: m.content,
        ...(hasToolCalls
          ? {
              tool_calls: m.toolCalls!.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            }
          : {}),
      });
      continue;
    }

    if (m.role === 'system' || m.role === 'user') {
      if (!content) continue;
      out.push({ role: m.role, content: m.content });
      continue;
    }
  }
  return out;
}

/**
 * Convert Kavis ToolDefinition array to OpenAI function tool definitions.
 */
export function buildToolDefinitions(
  tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[]
): ToolDef[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export interface RequestConfig {
  sanitizedMsgs: OpenAIMessage[];
  toolDefs: ToolDef[] | undefined;
  bodyJson: string;
}

/**
 * Prepare the full request configuration for an upstream OpenAI call.
 * Handles message sanitization, tool definition conversion, and JSON body
 * serialization in one step so the adapter only passes the result to the SDK.
 */
export function prepareRequestConfig(
  messages: Message[],
  tools: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[],
  model: string
): RequestConfig {
  const sanitizedMsgs = sanitizeMessagesForUpstream(messages);
  const toolDefs = buildToolDefinitions(tools);
  const bodyJson = JSON.stringify({
    model,
    messages: sanitizedMsgs,
    tools: toolDefs,
    stream: true,
  });
  return { sanitizedMsgs, toolDefs, bodyJson };
}

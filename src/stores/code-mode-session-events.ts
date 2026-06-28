import type { CodeModeMessage, CodeModeToolCall } from './code-mode-session-types';

export function parseToolCallData(data: unknown): { id: string; name: string; summary?: string } | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const name = typeof obj.name === 'string' && obj.name ? obj.name : undefined;
  const id = obj.id ?? obj.call_id ?? obj.tool_call_id;
  if (name && id) {
    return { id: String(id), name, summary: typeof obj.raw === 'object' ? JSON.stringify((obj.raw as Record<string, unknown>).input ?? '').slice(0, 80) : undefined };
  }
  return null;
}

export function parseToolResultId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const id = obj.id ?? obj.call_id ?? obj.tool_call_id;
  return typeof id === 'string' && id ? id : null;
}

export function updateToolStatus(
  tools: CodeModeToolCall[],
  id: string,
  status: 'done' | 'error',
): CodeModeToolCall[] {
  return tools.map((t) => (t.id === id ? { ...t, status } : t));
}

export function applyEventToMessages(
  messages: CodeModeMessage[],
  event: { type: string; data: unknown },
): CodeModeMessage[] {
  if (event.type === 'text_delta') {
    const text = (event.data as { text?: string })?.text ?? '';
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    return [...messages.slice(0, -1), { ...last, content: last.content + text }];
  }

  if (event.type === 'error') {
    const msg = (event.data as { message?: string })?.message ?? 'Unknown error';
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    return [
      ...messages.slice(0, -1),
      { ...last, content: `${last.content}\n\n> **Error:** ${msg}` },
    ];
  }

  if (event.type === 'thinking') {
    const text = (event.data as { text?: string })?.text ?? '';
    if (!text) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    return [
      ...messages.slice(0, -1),
      { ...last, thinking: (last.thinking ?? '') + text },
    ];
  }

  if (event.type === 'tool_call') {
    const parsed = parseToolCallData(event.data);
    if (!parsed) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const existing = last.toolCalls ?? [];
    if (existing.some((t) => t.id === parsed.id)) return messages;
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        toolCalls: [...existing, { id: parsed.id, name: parsed.name, status: 'running', summary: parsed.summary }],
      },
    ];
  }

  if (event.type === 'tool_result') {
    const resultId = parseToolResultId(event.data);
    if (!resultId) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const tools = last.toolCalls;
    if (!tools || !tools.some((t) => t.id === resultId)) return messages;
    return [
      ...messages.slice(0, -1),
      { ...last, toolCalls: updateToolStatus(tools, resultId, 'done') },
    ];
  }

  if (event.type === 'hook_event') {
    const data = event.data as {
      hookType?: string;
      status?: string;
      round?: number;
      detail?: string;
    };
    if (!data?.hookType || !data?.status) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const hookEvents = last.hookEvents ?? [];
    const status = data.status as 'start' | 'continue' | 'rewrite' | 'abort';
    const entry = {
      id: crypto.randomUUID(),
      hookType: data.hookType,
      status,
      round: data.round,
      detail: data.detail,
    };
    return [
      ...messages.slice(0, -1),
      { ...last, hookEvents: [...hookEvents, entry] },
    ];
  }

  if (event.type === 'session_meta') {
    const data = event.data as { cliSessionId?: string } | undefined;
    if (data?.cliSessionId) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && !last.nativeSessionId) {
        return [...messages.slice(0, -1), { ...last, nativeSessionId: data.cliSessionId }];
      }
    }
    return messages;
  }

  if (event.type === 'progress') {
    const summary = extractProgressSummary(event.data);
    if (!summary) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const logs = last.progress ?? [];
    if (logs.length > 0 && logs[logs.length - 1] === summary) return messages;
    return [
      ...messages.slice(0, -1),
      { ...last, progress: [...logs, summary] },
    ];
  }

  return messages;
}

/** Extract a human-readable progress summary from lifecycle NDJSON. */
export function extractProgressSummary(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const t = typeof obj.type === 'string' ? obj.type : '';

  switch (t) {
    case 'step_start': {
      const stepRaw = obj.step;
      const step = typeof stepRaw === 'object' && stepRaw ? (stepRaw as Record<string, unknown>) : undefined;
      const stepType = typeof step?.type === 'string' ? step.type : '';
      if (stepType === 'tool_use' && typeof step?.name === 'string') return `Running ${step.name}...`;
      if (stepType === 'thinking') return 'Thinking...';
      return 'Processing...';
    }
    case 'step_finish': return null;
    case 'message_start': return null;
    case 'message_stop': return null;
    case 'thread.started': return 'Starting thread...';
    case 'turn.started': return 'Starting turn...';
    case 'turn.completed': return null;
    case 'response.created': return 'Generating response...';
    case 'response.completed': return null;
    case 'response.output_item.added': {
      const item = obj.item as Record<string, unknown> | undefined;
      if (item?.type === 'tool_use' || item?.type === 'tool_call') {
        return `Executing ${item.name ?? 'tool'}...`;
      }
      return null;
    }
    case 'tool_use': {
      const name = typeof obj.name === 'string' ? obj.name : undefined;
      if (name) return `Running ${name}...`;
      return 'Running tool...';
    }
    case 'system': return null;
    default: return null;
  }
}

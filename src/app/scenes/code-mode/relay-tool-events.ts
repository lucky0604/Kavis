import type { ToolCardData } from './InspectorPane';

/** Parse heterogeneous CLI NDJSON into a normalized tool call, or null if not a real tool. */
export function parseRelayToolCall(data: unknown): { id: string; name: string; summary: string } | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.name === 'string' && obj.name.length > 0) {
    const id = String(obj.id ?? obj.call_id ?? obj.tool_call_id ?? '');
    if (id) return { id, name: obj.name, summary: '' };
  }

  if (obj.type === 'tool_use' && typeof obj.name === 'string') {
    return {
      id: String(obj.id ?? `tool-${Date.now()}`),
      name: obj.name,
      summary: typeof obj.input === 'object' ? JSON.stringify(obj.input).slice(0, 120) : '',
    };
  }

  const item = obj.item as Record<string, unknown> | undefined;
  if (item && typeof item === 'object') {
    if (item.type === 'function_call' && typeof item.name === 'string') {
      return {
        id: String(item.call_id ?? item.id ?? `tool-${Date.now()}`),
        name: item.name,
        summary: typeof item.arguments === 'string' ? item.arguments.slice(0, 120) : '',
      };
    }
  }

  return null;
}

/** Resolve tool_result to a call id when possible. */
export function parseRelayToolResultId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  const direct = obj.id ?? obj.call_id ?? obj.tool_call_id;
  if (typeof direct === 'string' && direct) return direct;

  const item = obj.item as Record<string, unknown> | undefined;
  if (item && typeof item === 'object') {
    const nested = item.call_id ?? item.id;
    if (typeof nested === 'string' && nested) return nested;
  }

  return null;
}

export function applyRelayToolEvent(
  tools: ToolCardData[],
  event: { type: string; data: unknown },
): ToolCardData[] {
  if (event.type === 'tool_call') {
    const parsed = parseRelayToolCall(event.data);
    if (!parsed) return tools;
    if (tools.some((t) => t.id === parsed.id)) return tools;
    return [...tools, { ...parsed, status: 'running' }];
  }

  if (event.type === 'tool_result') {
    const resultId = parseRelayToolResultId(event.data);
    if (resultId) {
      return tools.map((t) =>
        t.id === resultId ? { ...t, status: 'done' as const } : t,
      );
    }
    // Fallback: complete the most recent running tool
    const lastRunning = [...tools].reverse().find((t) => t.status === 'running');
    if (lastRunning) {
      return tools.map((t) =>
        t.id === lastRunning.id ? { ...t, status: 'done' as const } : t,
      );
    }
  }

  if (event.type === 'done' || event.type === 'exit') {
    return [];
  }

  return tools;
}

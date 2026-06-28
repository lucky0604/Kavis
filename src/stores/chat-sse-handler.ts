/**
 * SSE event processing for chat-store.
 * Extracted to keep chat-store.ts under 300 lines.
 */
import type { Message, ToolMeta, StreamEvent, SSEToolCall, SSEToolResult } from '../../shared/types';

// ---- Utility functions ----

export function generateId(): string {
  return crypto.randomUUID();
}

export function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'web_search':   return `"${(args.query as string) || ''}"`;
    case 'web_fetch':    return (args.url as string) || '';
    case 'read_file':    return (args.path as string) || '';
    case 'list_dir':     return (args.path as string) || '';
    case 'search_content': return `"${(args.pattern as string) || ''}"`;
    case 'shell_exec':   return (args.command as string) || '';
    case 'git_status':
    case 'git_diff':     return '';
    case 'write_file':   return (args.path as string) || '';
    default:             return '';
  }
}

function summarizeResult(_name: string, output: string): string {
  try {
    const parsed = JSON.parse(output);
    if (parsed?.totalCount !== undefined) return `${parsed.totalCount} results`;
    if (parsed?.error) return `Error: ${parsed.error}`;
    if (typeof parsed === 'string') return parsed.slice(0, 80);
  } catch { /* not JSON */ }
  return output.slice(0, 80);
}

export function buildResultMeta(name: string, output: string, success: boolean): Partial<ToolMeta> {
  const meta: Partial<ToolMeta> = { status: success ? 'done' : 'error' };

  if (success) {
    meta.resultSummary = summarizeResult(name, output);
  }

  if (name === 'web_search' && success) {
    try {
      const parsed = JSON.parse(output);
      if (parsed?.results && Array.isArray(parsed.results)) {
        meta.sources = parsed.results.map((r: { title?: string; url?: string }) => ({
          title: r.title || '',
          url: r.url || '',
        }));
        meta.resultSummary = `${parsed.results.length} results from ${(meta.sources || []).map(s => { try { return new URL(s.url).hostname.replace('www.', ''); } catch { return s.url; } }).filter((h: string, i: number, a: string[]) => a.indexOf(h) === i).slice(0, 5).join(', ')}`;
      }
    } catch { /* not JSON */ }
  }

  if (name === 'web_fetch' && success) {
    try {
      const parsed = JSON.parse(output);
      if (parsed?.url) {
        meta.sources = [{ title: parsed.title || parsed.url, url: parsed.url }];
        meta.resultSummary = parsed.title ? `${parsed.title}` : 'Page fetched';
      }
    } catch { /* not JSON */ }
  }

  meta.rawOutput = output;
  return meta;
}

// ---- SSE Event Processing ----

export interface SSEContext {
  set: (partial: Record<string, unknown>) => void;
  getMessages: () => Message[];
  pendingToolCalls: Map<string, { name: string; args: Record<string, unknown> }>;
  onDone: () => void;
}

/**
 * Process a single SSE event. Returns true if the stream should stop (done/error).
 */
export function processSSEEvent(event: StreamEvent, ctx: SSEContext): boolean {
  switch (event.type) {
    case 'text_delta': {
      const delta = (event.data as { text: string }).text;
      const msgs = [...ctx.getMessages()];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        last.content += delta;
        ctx.set({ messages: [...msgs] });
      } else {
        const newAssistant: Message = {
          id: generateId(), role: 'assistant', content: delta, timestamp: Date.now(),
        };
        ctx.set({ messages: [...msgs, newAssistant] });
      }
      return false;
    }

    case 'thinking': {
      const thinkingData = event.data as { text?: string };
      const thinkingContent = thinkingData.text ? `Thinking: ${thinkingData.text}` : 'Thinking...';
      const thinkingMsg: Message = {
        id: generateId(), role: 'system', content: thinkingContent, timestamp: Date.now(),
      };
      ctx.set({ messages: [...ctx.getMessages(), thinkingMsg] });
      return false;
    }

    case 'tool_call': {
      const tc = event.data as SSEToolCall;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.arguments || '{}'); } catch { /* ignore */ }
      const argSummary = summarizeToolArgs(tc.name, args);
      ctx.pendingToolCalls.set(tc.id, { name: tc.name, args });

      const toolMsg: Message = {
        id: generateId(), role: 'tool', content: '', toolCallId: tc.id,
        timestamp: Date.now(),
        toolMeta: { name: tc.name, status: 'running', argSummary } as ToolMeta,
      };
      ctx.set({ messages: [...ctx.getMessages(), toolMsg] });
      return false;
    }

    case 'tool_result': {
      const tr = event.data as SSEToolResult;
      const pending = ctx.pendingToolCalls.get(tr.id);
      const toolName = pending?.name || tr.name;
      const resultMeta = buildResultMeta(toolName, tr.output, tr.success);

      const msgs = [...ctx.getMessages()];
      const toolMsg = msgs.find(m => m.role === 'tool' && m.toolCallId === tr.id);
      if (toolMsg) {
        toolMsg.content = tr.output;
        toolMsg.toolMeta = {
          name: toolName,
          argSummary: pending ? summarizeToolArgs(toolName, pending.args) : '',
          ...resultMeta,
        } as ToolMeta;
        ctx.set({ messages: [...msgs] });
      } else {
        const newToolMsg: Message = {
          id: generateId(), role: 'tool', content: tr.output, toolCallId: tr.id,
          timestamp: Date.now(),
          toolMeta: { name: toolName, argSummary: '', ...resultMeta } as ToolMeta,
        };
        ctx.set({ messages: [...msgs, newToolMsg] });
      }
      ctx.pendingToolCalls.delete(tr.id);
      return false;
    }

    case 'done':
      ctx.set({ isStreaming: false });
      ctx.onDone();
      return true;

    case 'memory_recall': {
      const mr = event.data as import('../../shared/types').SSEMemoryRecall;
      const memMsg: Message = {
        id: generateId(), role: 'system', content: '', timestamp: Date.now(),
        eventMeta: { type: 'memory_recall', count: mr.count, memories: mr.memories },
      };
      ctx.set({ messages: [...ctx.getMessages(), memMsg] });
      return false;
    }

    case 'skill_review': {
      const sr = event.data as import('../../shared/types').SSESkillReview;
      const skillMsg: Message = {
        id: generateId(), role: 'system', content: '', timestamp: Date.now(),
        eventMeta: { type: 'skill_review', skill: sr.skill },
      };
      ctx.set({ messages: [...ctx.getMessages(), skillMsg] });
      return false;
    }

    case 'evolution_event': {
      const ee = event.data as import('../../shared/types').SSEEvolutionEvent;
      const evoMsg: Message = {
        id: generateId(), role: 'system', content: '', timestamp: Date.now(),
        eventMeta: { type: 'evolution_event', event: ee.event, detail: ee.detail },
      };
      ctx.set({ messages: [...ctx.getMessages(), evoMsg] });
      return false;
    }

    case 'approval_required': {
      if (!event.data || typeof event.data !== 'object') return false;
      const raw = event.data as unknown as Record<string, unknown>;
      if (!raw.id || !raw.name || raw.toolCallId === undefined) return false;
      const ar = event.data as {
        id: string;
        toolCallId: string;
        name: string;
        path: string;
        contentPreview: string;
        unifiedDiff?: string;
        bytes: number;
      };
      const approvalMsg: Message = {
        id: generateId(), role: 'system', content: '', timestamp: Date.now(),
        eventMeta: {
          type: 'tool_approval', approvalId: ar.id, toolCallId: ar.toolCallId,
          toolName: ar.name, path: ar.path, contentPreview: ar.contentPreview,
          unifiedDiff: ar.unifiedDiff, bytes: ar.bytes, status: 'pending',
        },
      };
      ctx.set({ messages: [...ctx.getMessages(), approvalMsg] });
      return false;
    }

    case 'approval_resolved': {
      if (!event.data || typeof event.data !== 'object') return false;
      const raw = event.data as unknown as Record<string, unknown>;
      if (!raw.id || raw.approved === undefined) return false;
      const resolved = event.data;
      const msgs = [...ctx.getMessages()];
      const idx = msgs.findIndex(
        (m) => m.eventMeta?.type === 'tool_approval' && m.eventMeta.approvalId === resolved.id,
      );
      if (idx >= 0 && msgs[idx].eventMeta?.type === 'tool_approval') {
        msgs[idx] = {
          ...msgs[idx],
          eventMeta: { ...msgs[idx].eventMeta!, status: resolved.approved ? 'approved' : 'denied' },
        };
        ctx.set({ messages: [...msgs] });
      }
      return false;
    }

    case 'error': {
      const errData = event.data as import('../../shared/types').StreamErrorEventData;
      const parts: string[] = [];
      if (errData.kind === 'upstream') {
        const tag = [
          errData.status ? `HTTP ${errData.status}` : null,
          errData.code ? errData.code : null,
          errData.model,
        ].filter(Boolean).join(' · ');
        parts.push(`[Upstream${tag ? ' ' + tag : ''}]`);
        if (errData.baseUrl) parts.push(`@ ${errData.baseUrl}`);
      } else if (errData.kind === 'auth') {
        parts.push('[Auth]');
      } else if (errData.kind === 'rate_limit') {
        parts.push('[Rate limit]');
      }
      parts.push(errData.message || 'Unknown error');
      ctx.set({
        isStreaming: false,
        errorMessage: parts.join(' '),
        lastError: errData,
      });
      return true;
    }

    default:
      return false;
  }
}

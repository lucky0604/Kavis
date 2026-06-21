import { create } from 'zustand';
import type { Message, ToolMeta, StreamEvent, SSEToolCall, SSEToolResult, SSEMemoryRecall, SSESkillReview, SSEEvolutionEvent } from '../../shared/types';
import { useAgentStore, useSessionStore } from './app-stores';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  isConnecting: boolean;
  connectionError: boolean;
  errorMessage: string | null;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  workspacePath: string;
  sessionId: string;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  setApiKey: (key: string) => void;
  setBaseUrl: (url: string) => void;
  setModelName: (model: string) => void;
  setWorkspacePath: (path: string) => void;
  clearError: () => void;
  addMessage: (msg: Message) => void;
  switchAgent: (agentId: string) => void;
  resetSession: () => void;
  respondToApproval: (approvalId: string, approved: boolean) => Promise<void>;
  hydrateSettings: () => Promise<void>;
}

let abortController: AbortController | null = null;

function generateId(): string {
  return crypto.randomUUID();
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'web_search':
      return `"${(args.query as string) || ''}"`;
    case 'web_fetch':
      return (args.url as string) || '';
    case 'read_file':
      return (args.path as string) || '';
    case 'list_dir':
      return (args.path as string) || '';
    case 'search_content':
      return `"${(args.pattern as string) || ''}"`;
    case 'shell_exec':
      return (args.command as string) || '';
    case 'git_status':
      return '';
    case 'git_diff':
      return '';
    case 'write_file':
      return (args.path as string) || '';
    default:
      return '';
  }
}

function buildResultMeta(name: string, output: string, success: boolean): Partial<ToolMeta> {
  const meta: Partial<ToolMeta> = {
    status: success ? 'done' : 'error',
  };

  if (success) {
    meta.resultSummary = summarizeResult(name, output);
  }

  if (name === 'web_search' && success) {
    try {
      const parsed = JSON.parse(output);
      if (parsed?.results && Array.isArray(parsed.results)) {
        meta.sources = parsed.results.map((r: { title?: string; url?: string; snippet?: string }) => ({
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

function summarizeResult(_name: string, output: string): string {
  try {
    const parsed = JSON.parse(output);
    if (parsed?.totalCount !== undefined) return `${parsed.totalCount} results`;
    if (parsed?.error) return `Error: ${parsed.error}`;
    if (typeof parsed === 'string') return parsed.slice(0, 80);
  } catch { /* not JSON */ }
  return output.slice(0, 80);
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  isConnecting: false,
  connectionError: false,
  errorMessage: null,
  apiKey: localStorage.getItem('janus_api_key') || '',
  baseUrl: localStorage.getItem('janus_base_url') || 'https://api.openai.com/v1',
  modelName: localStorage.getItem('janus_model') || 'gpt-4o',
  workspacePath: localStorage.getItem('janus_workspace') || '',
  sessionId: generateId(),

  sendMessage: async (content: string) => {
    const { apiKey, baseUrl, modelName, workspacePath, sessionId, messages } = get();
    const { activeMode, activeRole } = useAgentStore.getState();
    if (!apiKey) {
      set({ errorMessage: 'API key required' });
      return;
    }

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set({
      messages: [...messages, userMsg],
      isStreaming: true,
      isConnecting: true,
      connectionError: false,
      errorMessage: null,
    });

    const requestMessages = [...messages, userMsg];

    abortController = new AbortController();

    const pendingToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          messages: requestMessages,
          workspacePath: workspacePath.trim(),
          sessionId,
          baseUrl: baseUrl.trim(),
          modelName: modelName.trim(),
          agentId: activeMode === 'code' ? `${activeMode}/${activeRole}` : activeMode,
          mode: activeMode,
          role: activeMode === 'code' ? activeRole : undefined,
        }),
        signal: abortController.signal,
      });

      set({ isConnecting: false });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        set({
          isStreaming: false,
          errorMessage: err.error || `Request failed (${response.status})`,
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        set({ isStreaming: false, errorMessage: 'No response stream' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const eventBlocks = buffer.split(/\n\n/);
        buffer = eventBlocks.pop() || '';

        for (const block of eventBlocks) {
          const dataLines: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              dataLines.push(trimmed.slice(5).trimStart());
            }
          }

          if (dataLines.length === 0) continue;

          const json = dataLines.join('');
          if (json === '[DONE]') continue;

          try {
            const event: StreamEvent = JSON.parse(json);

            switch (event.type) {
              case 'text_delta': {
                const delta = (event.data as { text: string }).text;
                const msgs = [...get().messages];
                const last = msgs[msgs.length - 1];
                if (last && last.role === 'assistant') {
                  last.content += delta;
                  set({ messages: [...msgs] });
                } else {
                  const newAssistant: Message = {
                    id: generateId(),
                    role: 'assistant',
                    content: delta,
                    timestamp: Date.now(),
                  };
                  set({ messages: [...msgs, newAssistant] });
                }
                break;
              }
              case 'thinking': {
                const thinkingData = event.data as { text?: string };
                const thinkingContent = thinkingData.text ? `Thinking: ${thinkingData.text}` : 'Thinking...';
                const thinkingMsg: Message = {
                  id: generateId(),
                  role: 'system',
                  content: thinkingContent,
                  timestamp: Date.now(),
                };
                set({ messages: [...get().messages, thinkingMsg] });
                break;
              }
              case 'tool_call': {
                const tc = event.data as SSEToolCall;
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.arguments || '{}'); } catch { /* ignore */ }
                const argSummary = summarizeToolArgs(tc.name, args);
                pendingToolCalls.set(tc.id, { name: tc.name, args });

                const toolMsg: Message = {
                  id: generateId(),
                  role: 'tool',
                  content: '',
                  toolCallId: tc.id,
                  timestamp: Date.now(),
                  toolMeta: {
                    name: tc.name,
                    status: 'running',
                    argSummary,
                  } as ToolMeta,
                };
                set({ messages: [...get().messages, toolMsg] });
                break;
              }
              case 'tool_result': {
                const tr = event.data as SSEToolResult;
                const pending = pendingToolCalls.get(tr.id);
                const toolName = pending?.name || tr.name;

                const resultMeta = buildResultMeta(toolName, tr.output, tr.success);

                const msgs = [...get().messages];
                const toolMsg = msgs.find(m => m.role === 'tool' && m.toolCallId === tr.id);
                if (toolMsg) {
                  toolMsg.content = tr.output;
                  toolMsg.toolMeta = {
                    name: toolName,
                    argSummary: pending ? summarizeToolArgs(toolName, pending.args) : '',
                    ...resultMeta,
                  } as ToolMeta;
                  set({ messages: [...msgs] });
                } else {
                  const newToolMsg: Message = {
                    id: generateId(),
                    role: 'tool',
                    content: tr.output,
                    toolCallId: tr.id,
                    timestamp: Date.now(),
                    toolMeta: {
                      name: toolName,
                      argSummary: '',
                      ...resultMeta,
                    } as ToolMeta,
                  };
                  set({ messages: [...msgs, newToolMsg] });
                }
                pendingToolCalls.delete(tr.id);
                break;
              }
              case 'done':
                set({ isStreaming: false });
                useSessionStore.getState().refreshSessions();
                setTimeout(() => {
                  useSessionStore.getState().refreshSessions();
                }, 3000);
                return;
              case 'memory_recall': {
                const mr = event.data as SSEMemoryRecall;
                const memMsg: Message = {
                  id: generateId(),
                  role: 'system',
                  content: '',
                  timestamp: Date.now(),
                  eventMeta: {
                    type: 'memory_recall',
                    count: mr.count,
                    memories: mr.memories,
                  },
                };
                set({ messages: [...get().messages, memMsg] });
                break;
              }
              case 'skill_review': {
                const sr = event.data as SSESkillReview;
                const skillMsg: Message = {
                  id: generateId(),
                  role: 'system',
                  content: '',
                  timestamp: Date.now(),
                  eventMeta: {
                    type: 'skill_review',
                    skill: sr.skill,
                  },
                };
                set({ messages: [...get().messages, skillMsg] });
                break;
              }
              case 'evolution_event': {
                const ee = event.data as SSEEvolutionEvent;
                const evoMsg: Message = {
                  id: generateId(),
                  role: 'system',
                  content: '',
                  timestamp: Date.now(),
                  eventMeta: {
                    type: 'evolution_event',
                    event: ee.event,
                    detail: ee.detail,
                  },
                };
                set({ messages: [...get().messages, evoMsg] });
                break;
              }
              case 'approval_required': {
                if (!event.data || typeof event.data !== 'object') {
                  console.warn('[chat-store] approval_required event missing data');
                  break;
                }
                const raw = event.data as unknown as Record<string, unknown>;
                if (!raw.id || !raw.name || raw.toolCallId === undefined) {
                  console.warn('[chat-store] approval_required event missing required fields');
                  break;
                }
                const ar = event.data;
                const approvalMsg: Message = {
                  id: generateId(),
                  role: 'system',
                  content: '',
                  timestamp: Date.now(),
                  eventMeta: {
                    type: 'tool_approval',
                    approvalId: ar.id,
                    toolCallId: ar.toolCallId,
                    toolName: ar.name,
                    path: ar.path,
                    contentPreview: ar.contentPreview,
                    bytes: ar.bytes,
                    status: 'pending',
                  },
                };
                set({ messages: [...get().messages, approvalMsg] });
                break;
              }
              case 'approval_resolved': {
                if (!event.data || typeof event.data !== 'object') {
                  console.warn('[chat-store] approval_resolved event missing data');
                  break;
                }
                const raw = event.data as unknown as Record<string, unknown>;
                if (!raw.id || raw.approved === undefined) {
                  console.warn('[chat-store] approval_resolved event missing required fields');
                  break;
                }
                const resolved = event.data;
                const msgs = [...get().messages];
                const idx = msgs.findIndex(
                  (m) => m.eventMeta?.type === 'tool_approval' &&
                    m.eventMeta.approvalId === resolved.id,
                );
                if (idx >= 0 && msgs[idx].eventMeta?.type === 'tool_approval') {
                  msgs[idx] = {
                    ...msgs[idx],
                    eventMeta: {
                      ...msgs[idx].eventMeta!,
                      status: resolved.approved ? 'approved' : 'denied',
                    },
                  };
                  set({ messages: [...msgs] });
                }
                break;
              }
              case 'error': {
                set({
                  isStreaming: false,
                  errorMessage: (event.data as { message: string }).message || 'Unknown error',
                });
                return;
              }
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      set({ isStreaming: false });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && !last.content) {
          last.content = '[Stopped]';
        }
        set({ messages: [...msgs], isStreaming: false, isConnecting: false });
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        set({
          isStreaming: false,
          isConnecting: false,
          connectionError: true,
        });
      } else {
        set({
          isStreaming: false,
          isConnecting: false,
          errorMessage: err instanceof Error ? err.message : 'Connection failed',
        });
      }
    }
  },

  stopGeneration: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  },

  setApiKey: (key: string) => {
    localStorage.setItem('janus_api_key', key);
    window.janusNative?.setSetting?.('janus_api_key', key);
    set({ apiKey: key, errorMessage: null });
  },

  setBaseUrl: (url: string) => {
    localStorage.setItem('janus_base_url', url);
    window.janusNative?.setSetting?.('janus_base_url', url);
    set({ baseUrl: url });
  },

  setModelName: (model: string) => {
    localStorage.setItem('janus_model', model);
    window.janusNative?.setSetting?.('janus_model', model);
    set({ modelName: model });
  },

  setWorkspacePath: (path: string) => {
    localStorage.setItem('janus_workspace', path);
    window.janusNative?.setSetting?.('janus_workspace', path);
    set({ workspacePath: path });
  },

  clearError: () => set({ errorMessage: null, connectionError: false }),

  addMessage: (msg: Message) => {
    set({ messages: [...get().messages, msg] });
  },

  /** Switch agent/mode without clearing conversation history. */
  switchAgent: (_agentId: string) => {
    abortController?.abort();
    abortController = null;
    set({
      sessionId: crypto.randomUUID(),
      isStreaming: false,
      isConnecting: false,
      connectionError: false,
      errorMessage: null,
    });
  },

  /** Clear all messages and start fresh. Used by /clear command. */
  resetSession: () => {
    abortController?.abort();
    abortController = null;
    set({
      sessionId: crypto.randomUUID(),
      messages: [],
      isStreaming: false,
      isConnecting: false,
      connectionError: false,
      errorMessage: null,
    });
    // Refresh session list after clearing
    useSessionStore.getState().refreshSessions();
  },

  respondToApproval: async (approvalId, approved) => {
    const msgs = [...get().messages];
    const idx = msgs.findIndex(
      (m) => m.eventMeta?.type === 'tool_approval' &&
        m.eventMeta.approvalId === approvalId &&
        m.eventMeta.status === 'pending',
    );
    if (idx < 0) return;

    try {
      const res = await fetch('/api/chat/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId, approved }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        set({
          errorMessage: (err as { error?: string }).error || 'Failed to submit approval',
        });
        return;
      }

      if (msgs[idx].eventMeta?.type === 'tool_approval') {
        msgs[idx] = {
          ...msgs[idx],
          eventMeta: {
            ...msgs[idx].eventMeta!,
            status: approved ? 'approved' : 'denied',
          },
        };
        set({ messages: [...msgs] });
      }
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : 'Failed to submit approval',
      });
    }
  },

  /**
   * Hydrate settings from Electron's file-based persistence (IPC bridge).
   * Called once on app startup. Falls back to localStorage when running in
   * a regular browser (dev mode without Electron preload bridge).
   */
  hydrateSettings: async () => {
    if (typeof window === 'undefined' || !window.janusNative?.getSettings) {
      return;
    }
    try {
      const nativeSettings = await window.janusNative.getSettings();
      const updates: Partial<ChatState> = {};
      if (nativeSettings.janus_api_key) {
        updates.apiKey = nativeSettings.janus_api_key;
      }
      if (nativeSettings.janus_base_url) {
        updates.baseUrl = nativeSettings.janus_base_url;
      }
      if (nativeSettings.janus_model) {
        updates.modelName = nativeSettings.janus_model;
      }
      if (nativeSettings.janus_workspace) {
        updates.workspacePath = nativeSettings.janus_workspace;
      }
      if (Object.keys(updates).length > 0) {
        set(updates as Partial<ChatState>);
        if (typeof updates.apiKey === 'string') {
          localStorage.setItem('janus_api_key', updates.apiKey);
        }
        if (typeof updates.baseUrl === 'string') {
          localStorage.setItem('janus_base_url', updates.baseUrl);
        }
        if (typeof updates.modelName === 'string') {
          localStorage.setItem('janus_model', updates.modelName);
        }
        if (typeof updates.workspacePath === 'string') {
          localStorage.setItem('janus_workspace', updates.workspacePath);
        }
      }
    } catch {
      // IPC unavailable — keep localStorage values
    }
  },
}));
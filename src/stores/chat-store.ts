import { create } from 'zustand';
import type { Message, ToolMeta, StreamEvent, SSEToolCall, SSEToolResult } from '../../shared/types';

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
}

let abortController: AbortController | null = null;

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Build a short human-readable summary of a tool call's arguments.
 */
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

/**
 * Build a ToolMeta from a tool_result event, parsing the output for
 * structured information like source URLs.
 */
function buildResultMeta(name: string, output: string, success: boolean): Partial<ToolMeta> {
  const meta: Partial<ToolMeta> = {
    status: success ? 'done' : 'error',
  };

  if (success) {
    meta.resultSummary = summarizeResult(name, output);
  }

  // Extract sources for web_search results
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

  // Extract URL for web_fetch results
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

    // Build the messages array that includes the user's current input
    const requestMessages = [...messages, userMsg];

    abortController = new AbortController();

    // Track pending tool calls so we can match results
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

        // SSE: events are separated by blank lines (\n\n)
        const eventBlocks = buffer.split(/\n\n/);
        // Last block may be incomplete — keep in buffer
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
                  // Append to existing assistant message (same round)
                  last.content += delta;
                  set({ messages: [...msgs] });
                } else {
                  // New round after tool calls: create a fresh assistant message.
                  // The previous round's accumulated content belongs to that round's message.
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
              case 'tool_call': {
                const tc = event.data as SSEToolCall;
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.arguments || '{}'); } catch { /* ignore */ }
                const argSummary = summarizeToolArgs(tc.name, args);
                pendingToolCalls.set(tc.id, { name: tc.name, args });

                // Insert a tool message showing "running" state
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

                // Update the matching tool message with result data
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
                  // No matching tool_call seen — insert a completed tool message
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
                return;
              case 'error': {
                set({
                  isStreaming: false,
                  errorMessage: (event.data as { message: string }).message || 'Unknown error',
                });
                return;
              }
            }
          } catch {
            // Skip malformed events — don't crash the stream
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
    set({ apiKey: key, errorMessage: null });
  },

  setBaseUrl: (url: string) => {
    localStorage.setItem('janus_base_url', url);
    set({ baseUrl: url });
  },

  setModelName: (model: string) => {
    localStorage.setItem('janus_model', model);
    set({ modelName: model });
  },

  setWorkspacePath: (path: string) => {
    localStorage.setItem('janus_workspace', path);
    set({ workspacePath: path });
  },

  clearError: () => set({ errorMessage: null, connectionError: false }),

  addMessage: (msg: Message) => {
    set({ messages: [...get().messages, msg] });
  },
}));

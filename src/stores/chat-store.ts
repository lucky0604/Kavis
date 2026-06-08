import { create } from 'zustand';
import type { Message, StreamEvent } from '../../shared/types';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  isConnecting: boolean;
  connectionError: boolean;
  errorMessage: string | null;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  sessionId: string;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  setApiKey: (key: string) => void;
  setBaseUrl: (url: string) => void;
  setModelName: (model: string) => void;
  clearError: () => void;
  addMessage: (msg: Message) => void;
}

let abortController: AbortController | null = null;

function generateId(): string {
  return crypto.randomUUID();
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  isConnecting: false,
  connectionError: false,
  errorMessage: null,
  apiKey: sessionStorage.getItem('janus_api_key') || '',
  baseUrl: sessionStorage.getItem('janus_base_url') || 'https://api.openai.com/v1',
  modelName: sessionStorage.getItem('janus_model') || 'gpt-4o',
  sessionId: generateId(),

  sendMessage: async (content: string) => {
    const { apiKey, baseUrl, modelName, sessionId, messages } = get();
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

    const assistantMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    set({
      messages: [...messages, userMsg, assistantMsg],
      isStreaming: true,
      isConnecting: true,
      connectionError: false,
      errorMessage: null,
    });

    abortController = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          messages: messages,
          workspacePath: '',
          sessionId,
          baseUrl,
          modelName,
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
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') continue;

          try {
            const event: StreamEvent = JSON.parse(json);

            switch (event.type) {
              case 'text_delta': {
                const delta = (event.data as { text: string }).text;
                accumulatedContent += delta;
                const msgs = [...get().messages];
                const last = msgs[msgs.length - 1];
                if (last && last.role === 'assistant') {
                  last.content = accumulatedContent;
                  set({ messages: [...msgs] });
                }
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
    sessionStorage.setItem('janus_api_key', key);
    set({ apiKey: key, errorMessage: null });
  },

  setBaseUrl: (url: string) => {
    sessionStorage.setItem('janus_base_url', url);
    set({ baseUrl: url });
  },

  setModelName: (model: string) => {
    sessionStorage.setItem('janus_model', model);
    set({ modelName: model });
  },

  clearError: () => set({ errorMessage: null, connectionError: false }),

  addMessage: (msg: Message) => {
    set({ messages: [...get().messages, msg] });
  },
}));

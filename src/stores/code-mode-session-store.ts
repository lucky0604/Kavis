import { create } from 'zustand';
import type { Message } from '../../shared/types';
import { useProjectStore } from './project-store';

export interface CodeModeToolCall {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

export interface CodeModeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: CodeModeToolCall[];
  thinking?: string;
  progress?: string[];
}

const ACTIVE_SESSION_KEY = 'janus_code_mode_session_id';
const ACTIVE_SESSION_PROJECT_KEY = 'janus_code_mode_session_project';

function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function saveActiveSessionId(sessionId: string | null, projectPath: string | null = null): void {
  try {
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
      if (projectPath) {
        localStorage.setItem(ACTIVE_SESSION_PROJECT_KEY, projectPath);
      }
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      localStorage.removeItem(ACTIVE_SESSION_PROJECT_KEY);
    }
  } catch {
    // ignore
  }
}

function loadActiveSessionProjectPath(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_PROJECT_KEY);
  } catch {
    return null;
  }
}

function toStoreMessages(messages: Message[]): CodeModeMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

function toPersistMessages(messages: CodeModeMessage[]): Message[] {
  const now = Date.now();
  return messages.map((m, i) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: now + i,
  }));
}

/**
 * Atomic guard: tracks the most recently requested session ID for async ops.
 * - createSession sets it (any in-flight loadSession will bail)
 * - loadSession sets it before fetch, checks after fetch
 * This replaces the broken activeSessionId comparison guard which prevented
 * normal session switching (activeSessionId was the OLD id at check time).
 */
let _lastRequestedSessionId: string | null = null;

/** Set by ProjectItem when user explicitly opens a session — switchToProject skips its auto-init only for the matching project */
let _blockAutoInitForProject: string | null = null;

function parseToolCallData(data: unknown): { id: string; name: string; summary?: string } | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const name = typeof obj.name === 'string' && obj.name ? obj.name : undefined;
  const id = obj.id ?? obj.call_id ?? obj.tool_call_id;
  if (name && id) {
    return { id: String(id), name, summary: typeof obj.raw === 'object' ? JSON.stringify((obj.raw as Record<string, unknown>).input ?? '').slice(0, 80) : undefined };
  }
  return null;
}

function parseToolResultId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const id = obj.id ?? obj.call_id ?? obj.tool_call_id;
  return typeof id === 'string' && id ? id : null;
}

function updateToolStatus(
  tools: CodeModeToolCall[],
  id: string,
  status: 'done' | 'error',
): CodeModeToolCall[] {
  return tools.map((t) => (t.id === id ? { ...t, status } : t));
}

function applyEventToMessages(
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

  // ── Thinking / reasoning from model (e.g. DeepSeek thinking blocks) ──
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

  // ── Tool call started ──
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

  // ── Tool call completed ──
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

  // ── Progress / lifecycle events (step_start, tool_execution, etc.) ──
  if (event.type === 'progress') {
    const summary = extractProgressSummary(event.data);
    if (!summary) return messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return messages;
    const logs = last.progress ?? [];
    if (logs.length > 0 && logs[logs.length - 1] === summary) return messages; // dedup
    return [
      ...messages.slice(0, -1),
      { ...last, progress: [...logs, summary] },
    ];
  }

  return messages;
}

/** Extract a human-readable progress summary from lifecycle NDJSON. */
function extractProgressSummary(data: unknown): string | null {
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
    case 'step_finish': return null; // don't render completion of steps
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

interface CodeModeSessionState {
  activeSessionId: string | null;
  activeProjectPath: string | null;
  messages: CodeModeMessage[];
  sessionCache: Record<string, CodeModeMessage[]>;
  executingSessions: Record<string, boolean>;
  sessionListVersion: number;

  createSession: (projectPath: string, name?: string) => Promise<string>;
  blockAutoInit: () => void;
  switchToProject: (projectPath: string) => Promise<void>;
  ensureSessionForProject: (projectPath: string, preferFresh?: boolean) => Promise<void>;
  ensureSessionBeforeSend: () => Promise<boolean>;
  loadSession: (sessionId: string, projectPath?: string) => Promise<void>;
  clearActiveSession: () => void;
  appendExchange: (userContent: string) => void;
  applyStreamEvent: (sessionId: string, event: { type: string; data: unknown }) => void;
  setSessionExecuting: (sessionId: string, executing: boolean) => void;
  isSessionExecuting: (sessionId: string) => boolean;
  persistSession: (sessionId?: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  bumpSessionList: () => void;
}

function flushActiveToCache(
  activeSessionId: string | null,
  messages: CodeModeMessage[],
  sessionCache: Record<string, CodeModeMessage[]>,
): Record<string, CodeModeMessage[]> {
  if (!activeSessionId) return sessionCache;
  // Only update sessions that already exist in the cache (were loaded from
  // API or created via createSession).  On cold start the activeSessionId
  // comes from localStorage but sessionCache is empty — writing an empty []
  // there would trick the warm-cache check into thinking the session was
  // already loaded, preventing the real API fetch.
  if (!(activeSessionId in sessionCache)) return sessionCache;
  return { ...sessionCache, [activeSessionId]: messages };
}

export const useCodeModeSessionStore = create<CodeModeSessionState>((set, get) => ({
  activeSessionId: loadActiveSessionId(),
  activeProjectPath: loadActiveSessionProjectPath(),
  messages: [],
  sessionCache: {},
  executingSessions: {},
  sessionListVersion: 0,

  blockAutoInit: () => {
    const currentProject = get().activeProjectPath;
    if (currentProject) {
      _blockAutoInitForProject = currentProject;
    }
  },

  createSession: async (projectPath, name) => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, name, agentType: 'code-mode' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Failed to create session');
    }

    const data = await res.json();
    const sessionId = data.session.sessionId as string;

    _lastRequestedSessionId = sessionId;

    saveActiveSessionId(sessionId, projectPath);
    // Use functional set to flush the current session atomically with fresh state,
    // preventing stale snapshots from overwriting concurrent cache updates.
    set((state) => {
      const flushed = flushActiveToCache(state.activeSessionId, state.messages, state.sessionCache);
      return {
        activeSessionId: sessionId,
        activeProjectPath: projectPath,
        messages: [],
        sessionCache: { ...flushed, [sessionId]: [] },
        sessionListVersion: state.sessionListVersion + 1,
      };
    });
    return sessionId;
  },

  switchToProject: async (projectPath) => {
    if (_blockAutoInitForProject === projectPath) {
      _blockAutoInitForProject = null;
      return;
    }

    const { activeSessionId, activeProjectPath } = get();
    if (activeSessionId && activeProjectPath === projectPath) {
      // Only reload if this session has NEVER been loaded into the cache
      // (undefined). An empty array [] means the session is genuinely blank
      // and should not be re-fetched.
      const cached = get().sessionCache[activeSessionId];
      if (cached === undefined && !get().executingSessions[activeSessionId]) {
        await get().loadSession(activeSessionId, projectPath);
      }
      return;
    }
    await get().ensureSessionForProject(projectPath);
  },

  ensureSessionForProject: async (projectPath, preferFresh = false) => {
    const snap = get();
    if (snap.activeSessionId && snap.activeProjectPath === projectPath) {
      return;
    }

    if (!preferFresh) {
      try {
        const res = await fetch(
          `/api/sessions?scope=code-mode&workspace=${encodeURIComponent(projectPath)}`,
        );
        if (res.ok) {
          const data = await res.json();
          const sessions = (data.sessions || []) as Array<{ sessionId: string }>;
          if (sessions.length > 0) {
            await get().loadSession(sessions[0].sessionId, projectPath);
            return;
          }
        }
      } catch {
        // fall through to create
      }
    }

    const { activeSessionId, activeProjectPath } = get();
    if (activeSessionId && activeProjectPath === projectPath) {
      return;
    }

    await get().createSession(projectPath);
  },

  ensureSessionBeforeSend: async () => {
    if (get().activeSessionId) return true;

    const project = useProjectStore.getState().getActiveProject();
    if (!project) return false;

    try {
      await get().createSession(project.path);
      return true;
    } catch {
      return false;
    }
  },

  loadSession: async (sessionId, projectPath) => {
    const { activeSessionId, messages, sessionCache } = get();
    const nextCache = flushActiveToCache(activeSessionId, messages, sessionCache);

    const cached = nextCache[sessionId];

    // cached !== undefined means we already have this session's state in memory
    // (including empty [] for blank sessions). Only fall through to API when
    // the session has never been loaded into the cache at all.
    if (cached !== undefined) {
      const resolvedProjectPath = projectPath ?? get().activeProjectPath;
      saveActiveSessionId(sessionId, resolvedProjectPath ?? null);
      set({
        activeSessionId: sessionId,
        activeProjectPath: resolvedProjectPath ?? null,
        messages: cached,
        sessionCache: nextCache,
      });
      return;
    }

    _lastRequestedSessionId = sessionId;

    const res = await fetch(`/api/sessions/${sessionId}/load`, { method: 'POST' });
    if (!res.ok) {
      throw new Error('Failed to load session');
    }

    const data = await res.json();

    if (_lastRequestedSessionId !== sessionId) return;

    const loaded = toStoreMessages(data.messages || []);
    const resolvedProjectPath =
      projectPath ||
      (data.metadata as { projectPath?: string } | undefined)?.projectPath ||
      get().activeProjectPath;

    saveActiveSessionId(sessionId, resolvedProjectPath ?? null);
    // Use functional set to merge with the LATEST sessionCache, avoiding
    // stale nextCache from overwriting concurrent updates (e.g. streaming).
    set((state) => ({
      activeSessionId: sessionId,
      activeProjectPath: resolvedProjectPath ?? null,
      messages: loaded,
      sessionCache: { ...state.sessionCache, [sessionId]: loaded },
    }));
  },

  clearActiveSession: () => {
    saveActiveSessionId(null);
    set({ activeSessionId: null, activeProjectPath: null, messages: [] });
  },

  appendExchange: (userContent) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;

    const userMsg: CodeModeMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
    };
    const aiMsg: CodeModeMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
    };
    set((state) => {
      const base = state.sessionCache[sessionId] ?? state.messages;
      const nextMessages = [...base, userMsg, aiMsg];
      return {
        messages: nextMessages,
        sessionCache: { ...state.sessionCache, [sessionId]: nextMessages },
      };
    });
  },

  applyStreamEvent: (sessionId, event) => {
    set((state) => {
      const source =
        state.sessionCache[sessionId] ??
        (state.activeSessionId === sessionId ? state.messages : []);
      const updated = applyEventToMessages(source, event);
      const sessionCache = { ...state.sessionCache, [sessionId]: updated };
      if (state.activeSessionId !== sessionId) {
        return { sessionCache };
      }
      return { messages: updated, sessionCache };
    });
  },

  setSessionExecuting: (sessionId, executing) => {
    set((state) => {
      const executingSessions = { ...state.executingSessions };
      if (executing) {
        executingSessions[sessionId] = true;
      } else {
        delete executingSessions[sessionId];
      }
      return { executingSessions };
    });
  },

  isSessionExecuting: (sessionId) => Boolean(get().executingSessions[sessionId]),

  persistSession: async (sessionId) => {
    const id = sessionId ?? get().activeSessionId;
    if (!id) return;

    const messages = get().sessionCache[id] ?? get().messages;
    if (messages.length === 0) return;

    const project = useProjectStore.getState().getActiveProject();
    await fetch(`/api/sessions/${id}/save`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: toPersistMessages(messages),
        projectPath: project?.path,
        agentType: 'code-mode',
      }),
    });
    set({ sessionListVersion: get().sessionListVersion + 1 });
  },

  deleteSession: async (sessionId) => {
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error('Failed to delete session');
    }

    const { activeSessionId, sessionCache, executingSessions } = get();
    const nextCache = { ...sessionCache };
    delete nextCache[sessionId];
    const nextExecuting = { ...executingSessions };
    delete nextExecuting[sessionId];

    if (activeSessionId === sessionId) {
      saveActiveSessionId(null);
      set({
        activeSessionId: null,
        activeProjectPath: null,
        messages: [],
        sessionCache: nextCache,
        executingSessions: nextExecuting,
        sessionListVersion: get().sessionListVersion + 1,
      });
    } else {
      set({
        sessionCache: nextCache,
        executingSessions: nextExecuting,
        sessionListVersion: get().sessionListVersion + 1,
      });
    }
  },

  bumpSessionList: () => {
    set({ sessionListVersion: get().sessionListVersion + 1 });
  },
}));

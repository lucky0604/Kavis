import { create } from 'zustand';
import { useChatStore } from './chat-store';
import type { OperatingModeId, AgentRoleId } from '../../shared/types';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    return (localStorage.getItem('janus_theme') as Theme) || 'dark';
  } catch {
    return 'dark';
  }
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),

  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('janus_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next });
  },
}));

document.documentElement.setAttribute('data-theme', getInitialTheme());

// ---- Operating Mode + Agent Role UI metadata ----

export interface ModeUI {
  id: OperatingModeId;
  name: string;
  description: string;
  iconKey: string;
}

export interface RoleUI {
  id: AgentRoleId;
  name: string;
  description: string;
}

const DEFAULT_MODES: ModeUI[] = [
  {
    id: 'work',
    name: 'Work Mode',
    description: 'Daily productivity — search, read, write files, run commands',
    iconKey: 'briefcase',
  },
  {
    id: 'code',
    name: 'Code Mode',
    description: 'AI-powered coding — read, edit, debug, and review code',
    iconKey: 'code2',
  },
];

const DEFAULT_ROLES: RoleUI[] = [
  { id: 'agentic', name: 'Agentic', description: 'Full autonomy — reads, edits, debugs, and completes tasks' },
  { id: 'plan',    name: 'Plan',    description: 'Plan before acting — clarifies requirements then creates plans' },
  { id: 'ask',     name: 'Ask',     description: 'Read-only research — search, read, analyze, explain' },
  { id: 'debug',   name: 'Debug',   description: 'Systematic debugging — investigate, diagnose, and fix issues' },
];

export function compositeKey(modeId: OperatingModeId, roleId?: AgentRoleId): string {
  return roleId ? `${modeId}/${roleId}` : modeId;
}

interface AgentState {
  modes: ModeUI[];
  roles: RoleUI[];
  activeMode: OperatingModeId;
  activeRole: AgentRoleId;
  setMode: (mode: OperatingModeId) => void;
  setRole: (role: AgentRoleId) => void;
  fetchAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  modes: DEFAULT_MODES,
  roles: DEFAULT_ROLES,
  activeMode: 'work',
  activeRole: 'agentic',

  setMode: (modeId: OperatingModeId) => {
    const { activeRole, activeMode: prevMode } = get();
    if (modeId === prevMode) return;
    set({ activeMode: modeId });
    const key = compositeKey(modeId, modeId === 'code' ? activeRole : undefined);
    useChatStore.getState().switchAgent(key);
    // Sync scene navigation with mode selection
    const sceneStore = useSceneStore.getState();
    if (modeId === 'code' && sceneStore.currentScene !== 'code_mode') {
      set({ activeMode: modeId }); // ensure set before navigate
      useSceneStore.setState({ currentScene: 'code_mode' });
    } else if (modeId !== 'code' && sceneStore.currentScene === 'code_mode') {
      useSceneStore.setState({ currentScene: 'chat' });
    }
  },

  setRole: (roleId: AgentRoleId) => {
    const { activeMode } = get();
    set({ activeRole: roleId });
    const key = compositeKey(activeMode, roleId);
    useChatStore.getState().switchAgent(key);
  },

  fetchAgents: async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        if (data.modes) {
          set({
            modes: data.modes.map((m: Record<string, unknown>) => ({
              id: m.id as OperatingModeId,
              name: m.name as string,
              description: m.description as string,
              iconKey: (m.iconKey as string) || 'circle',
            })),
          });
        }
        if (data.roles) {
          set({
            roles: data.roles.map((r: Record<string, unknown>) => ({
              id: r.id as AgentRoleId,
              name: r.name as string,
              description: r.description as string,
            })),
          });
        }
      }
    } catch {
      // Backend unavailable — keep defaults
    }
  },
}));

// ---- Layout Store (Code Mode three-pane widths) ----
interface LayoutState {
  sidebarWidth: number;
  inspectorWidth: number;
  ptyHeight: number;
  setSidebarWidth: (w: number) => void;
  setInspectorWidth: (w: number) => void;
  setPtyHeight: (h: number) => void;
}

function loadNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v ? Number(v) : fallback;
  } catch {
    return fallback;
  }
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarWidth: loadNum('janus_sidebar_w', 260),
  inspectorWidth: loadNum('janus_inspector_w', 380),
  ptyHeight: loadNum('janus_pty_h', 40),

  setSidebarWidth: (w) => {
    localStorage.setItem('janus_sidebar_w', String(w));
    set({ sidebarWidth: w });
  },
  setInspectorWidth: (w) => {
    localStorage.setItem('janus_inspector_w', String(w));
    set({ inspectorWidth: w });
  },
  setPtyHeight: (h) => {
    localStorage.setItem('janus_pty_h', String(h));
    set({ ptyHeight: h });
  },
}));

// ---- Code-Mode Store ----
import type { CliToolId } from '../../shared/types';

interface CodeModeState {
  activeCli: CliToolId;
  activeModel: string;
  isRelaying: boolean;
  isExecuting: boolean;
  activeProcessId: number | null;
  setActiveCli: (cli: CliToolId) => void;
  setActiveModel: (model: string) => void;
  setRelaying: (v: boolean) => void;
  setExecuting: (v: boolean) => void;
  setActiveProcessId: (pid: number | null) => void;
}

export const useCodeModeStore = create<CodeModeState>((set) => ({
  activeCli: 'claudecode',
  activeModel: '',
  isRelaying: false,
  isExecuting: false,
  activeProcessId: null,
  setActiveCli: (cli) => set({ activeCli: cli }),
  setActiveModel: (model) => set({ activeModel: model }),
  setRelaying: (v) => set({ isRelaying: v }),
  setExecuting: (v) => set({ isExecuting: v }),
  setActiveProcessId: (pid) => set({ activeProcessId: pid }),
}));

// ---- Scene Store ----
type Scene = 'welcome' | 'chat' | 'settings' | 'terminal_spike' | 'code_mode';

interface SceneState {
  currentScene: Scene;
  navigate: (scene: Scene) => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  currentScene: 'welcome',

  navigate: (scene: Scene) => {
    if (scene === get().currentScene) return;
    set({ currentScene: scene });
    // Sync agent mode when navigating to/from code_mode via NavBar
    const agentState = useAgentStore.getState();
    if (scene === 'code_mode' && agentState.activeMode !== 'code') {
      useAgentStore.setState({ activeMode: 'code' });
    } else if (scene === 'chat' && agentState.activeMode === 'code') {
      useAgentStore.setState({ activeMode: 'work' });
    }
  },
}));

// ---- Session Store ----
interface SessionMetaUI {
  sessionId: string;
  name: string;
  agentType: string;
  turnCount: number;
  lastActiveAt: string;
}

interface SessionState {
  sessions: SessionMetaUI[];
  currentSessionId: string | null;
  setSessions: (sessions: SessionMetaUI[]) => void;
  setCurrentSession: (id: string | null) => void;
  addSession: (session: SessionMetaUI) => void;
  removeSession: (id: string) => void;
  refreshSessions: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSessionId: null,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  addSession: (session) =>
    set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) =>
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.sessionId !== id) })),

  refreshSessions: async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        set({ sessions: data.sessions || [] });
      }
    } catch {
      // ignore
    }
  },
}));
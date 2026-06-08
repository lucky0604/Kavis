import { create } from 'zustand';

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

// Initialize theme attribute on load
document.documentElement.setAttribute('data-theme', getInitialTheme());

// ---- Agent Store ----
export interface AgentUI {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  iconKey: string;
  status: 'active' | 'coming_soon';
}

const DEFAULT_AGENTS: AgentUI[] = [
  {
    id: 'work',
    name: 'Work Mode',
    description: 'Analyze, plan, and operate on local files',
    capabilities: ['File operations', 'Code search', 'Shell execution', 'Git'],
    iconKey: 'folder',
    status: 'active',
  },
  {
    id: 'code',
    name: 'Code',
    description: 'AI-powered code generation and modification',
    capabilities: ['Code generation', 'Code review', 'Refactoring', 'Testing'],
    iconKey: 'code2',
    status: 'coming_soon',
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Plan before acting — clarifies requirements then executes',
    capabilities: ['Planning', 'Analysis'],
    iconKey: 'clipboard',
    status: 'coming_soon',
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Systematic debugging — investigate and fix issues',
    capabilities: ['Debugging', 'Root cause analysis'],
    iconKey: 'bug',
    status: 'coming_soon',
  },
];

interface AgentState {
  agents: AgentUI[];
  activeAgentId: string;
  setActiveAgent: (id: string) => void;
  getActiveAgent: () => AgentUI | undefined;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: DEFAULT_AGENTS,
  activeAgentId: 'work',

  setActiveAgent: (id: string) => {
    set({ activeAgentId: id });
  },

  getActiveAgent: () => {
    return get().agents.find((a) => a.id === get().activeAgentId);
  },
}));

// ---- Scene Store ----
type Scene = 'welcome' | 'chat' | 'agents' | 'settings';

interface SceneState {
  currentScene: Scene;
  navigate: (scene: Scene) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  currentScene: 'welcome',

  navigate: (scene: Scene) => {
    set({ currentScene: scene });
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
  setCurrentSession: (id: string) => void;
  addSession: (session: SessionMetaUI) => void;
  removeSession: (id: string) => void;
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
}));

import type { CliToolId } from '../../shared/types';

export interface CodeModeToolCall {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

export interface CodeModeHookEvent {
  id: string;
  hookType: string;
  status: 'start' | 'continue' | 'rewrite' | 'abort';
  round?: number;
  detail?: string;
}

export interface CodeModeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cliId?: CliToolId;
  nativeSessionId?: string;
  toolCalls?: CodeModeToolCall[];
  hookEvents?: CodeModeHookEvent[];
  thinking?: string;
  progress?: string[];
}

export interface CodeModeSessionState {
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
  appendExchange: (userContent: string, cliId?: CliToolId) => void;
  applyStreamEvent: (sessionId: string, event: { type: string; data: unknown }) => void;
  setSessionExecuting: (sessionId: string, executing: boolean) => void;
  isSessionExecuting: (sessionId: string) => boolean;
  persistSession: (sessionId?: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  bumpSessionList: () => void;
}

// ---- Code Mode: External CLI Relay ----
export type CliToolId = 'kavis-code' | 'claudecode' | 'opencode' | 'codex';

export interface HandoffTodo {
  text: string;
  completed: boolean;
}

export interface HandoffContext {
  sessionId: string;
  projectPath: string;
  previousCli: CliToolId;
  nextCli: CliToolId;
  todos: HandoffTodo[];
  stashHash: string | null;
  commitSha: string;
  timestamp: string;
  version: 1;
}

export interface CliToolConfig {
  id: CliToolId;
  binaryName: string;
  displayName: string;
  subCommand?: string;
  defaultModels: string[];
  capabilities: {
    streamJson: boolean;
    ptyRequired: boolean;
    supportsModels: boolean;
  };
}

export interface CliDetectionResult {
  id: CliToolId;
  displayName: string;
  available: boolean;
  binaryPath: string | null;
  models: string[];
  defaultModel?: string;
}

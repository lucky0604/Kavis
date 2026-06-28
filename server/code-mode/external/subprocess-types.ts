export interface NdjsonEvent {
  type: 'text_delta' | 'text_final' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'exit' | 'session_meta';
  data: unknown;
  raw?: string;
}

export interface SubprocessStartOptions {
  /** Default 'ignore' — Codex/Claude non-interactive exec must not read stdin. */
  stdin?: 'pipe' | 'ignore';
}

export const BENIGN_STDERR = /Reading additional input from stdin/i;

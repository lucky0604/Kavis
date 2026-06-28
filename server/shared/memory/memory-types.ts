/**
 * Server-only types for the Memory System.
 * These types reference SQLite rows and internal structures
 * that should NOT be exposed to the frontend via shared/types.ts.
 */

// ---- SQLite Row Types ----

export interface PreferenceRow {
  key: string;
  value: string;
  category: string;
  confidence: number;
  updated_at: string;
}

export interface ProjectKnowledgeRow {
  id: number;
  project_path: string;
  key: string;
  value: string;
  category: string;
  created_at: string;
}

export interface ConversationSummaryRow {
  id: number;
  session_id: string;
  project_path: string | null;
  summary: string;
  key_decisions: string | null;  // JSON array
  tools_used: string | null;     // JSON array
  created_at: string;
}

export interface RecallTrackingRow {
  session_id: string;
  memory_id: string;
  recalled_at: string;
}

// ---- Internal Memory Types ----

export type MemoryCategory = 'fact' | 'preference' | 'procedure' | 'pattern' | 'context';
export type MemorySource = 'MEMORY.md' | 'daily_log' | 'conversation';

export interface MemoryIndexEntry {
  rowid: number;
  content: string;
  source: MemorySource;
  project_path: string;
  keywords: string;
  category: MemoryCategory;
  created_at: string;
}

/**
 * Internal memory context carried through the agent loop.
 * NOT the same as the frontend MemoryEntry.
 */
export interface MemoryContext {
  /** Path to MEMORY.md */
  persistentPath: string;
  /** Path to project-specific memory dir */
  memoryDir: string;
  /** Path to SQLite database */
  dbPath: string;
  /** Project path for scoping */
  projectPath: string;
  /** Session ID for recall tracking */
  sessionId: string;
  /** IDs of memories already surfaced in this session (avoid duplicates) */
  alreadySurfaced: Set<string>;
}

/**
 * Result from a recall operation — internal shape.
 * Converted to frontend MemoryEntry before sending via SSE.
 */
export interface RecallResult {
  id: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  createdAt: string;
  stalenessDays: number;
}

/**
 * Data extracted from a conversation for memory flush.
 */
export interface FlushData {
  facts: string[];
  preferences: string[];
  procedures: string[];
  dailyObservations: string[];
}

/**
 * Memory CRUD — SQLite-based persistent memory operations.
 *
 * Internal module. All exports are re-exported from persistent-memory.ts.
 */

import type {
  PreferenceRow,
  ProjectKnowledgeRow,
  MemoryIndexEntry,
  MemoryCategory,
  MemorySource,
} from './memory-types';
import { getDb } from './db-connection';

// ---- Preferences ----

export function getPreference(key: string, dbPath?: string): string | null {
  const db = getDb(dbPath);
  const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as PreferenceRow | undefined;
  return row?.value ?? null;
}

export function setPreference(key: string, value: string, category = 'general', confidence = 0.5, dbPath?: string): void {
  const db = getDb(dbPath);
  db.prepare(
    `INSERT INTO preferences (key, value, category, confidence, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category,
       confidence = excluded.confidence, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value, category, confidence);
}

export function getAllPreferences(dbPath?: string): PreferenceRow[] {
  const db = getDb(dbPath);
  return db.prepare('SELECT * FROM preferences ORDER BY category, key').all() as PreferenceRow[];
}

// ---- Project Knowledge ----

export function getProjectKnowledge(projectPath: string, key: string, dbPath?: string): string | null {
  const db = getDb(dbPath);
  const row = db.prepare(
    'SELECT value FROM project_knowledge WHERE project_path = ? AND key = ?'
  ).get(projectPath, key) as ProjectKnowledgeRow | undefined;
  return row?.value ?? null;
}

export function setProjectKnowledge(projectPath: string, key: string, value: string, category = 'general', dbPath?: string): void {
  const db = getDb(dbPath);
  db.prepare(
    `INSERT INTO project_knowledge (project_path, key, value, category)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_path, key) DO UPDATE SET value = excluded.value, category = excluded.category`
  ).run(projectPath, key, value, category);
}

// ---- Memory Index (FTS5) ----

export function indexMemory(
  content: string,
  source: MemorySource,
  projectPath: string,
  keywords: string,
  category: MemoryCategory,
  dbPath?: string
): number {
  const db = getDb(dbPath);
  const result = db.prepare(
    `INSERT INTO memory_index (content, source, project_path, keywords, category, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(content, source, projectPath, keywords, category);
  return Number(result.lastInsertRowid);
}

export function searchMemoryIndex(query: string, projectPath: string, limit = 10, dbPath?: string): MemoryIndexEntry[] {
  const db = getDb(dbPath);
  // FTS5 full-text search with BM25 ranking
  const results = db.prepare(
    `SELECT rowid, content, source, project_path, keywords, category, created_at
     FROM memory_index
     WHERE memory_index MATCH ?
     AND project_path = ?
     ORDER BY bm25(memory_index)
     LIMIT ?`
  ).all(query, projectPath, limit) as MemoryIndexEntry[];
  return results;
}

// ---- Conversation Summaries ----

export function saveConversationSummary(
  sessionId: string,
  projectPath: string,
  summary: string,
  keyDecisions: string[],
  toolsUsed: string[],
  dbPath?: string
): void {
  const db = getDb(dbPath);
  db.prepare(
    `INSERT INTO conversation_summaries (session_id, project_path, summary, key_decisions, tools_used)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, projectPath, summary, JSON.stringify(keyDecisions), JSON.stringify(toolsUsed));
}

// ---- Recall Tracking ----

export function markRecalled(sessionId: string, memoryId: string, dbPath?: string): void {
  const db = getDb(dbPath);
  db.prepare(
    `INSERT OR IGNORE INTO recall_tracking (session_id, memory_id, recalled_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`
  ).run(sessionId, memoryId);
}

export function isRecalled(sessionId: string, memoryId: string, dbPath?: string): boolean {
  const db = getDb(dbPath);
  const row = db.prepare(
    'SELECT 1 FROM recall_tracking WHERE session_id = ? AND memory_id = ?'
  ).get(sessionId, memoryId);
  return row !== undefined;
}

export function clearRecallTracking(sessionId: string, dbPath?: string): void {
  const db = getDb(dbPath);
  db.prepare('DELETE FROM recall_tracking WHERE session_id = ?').run(sessionId);
}

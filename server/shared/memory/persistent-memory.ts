/**
 * Persistent Memory — SQLite + MEMORY.md
 *
 * Layer 1 (常驻层): MEMORY.md index loaded at session start
 * Layer 3 (凝练层): Background consolidation updates MEMORY.md + SQLite
 *
 * Public API entry point. Implementation details split into:
 *   - db-connection.ts  — Singleton SQLite connection manager
 *   - memory-crud.ts    — SQLite CRUD operations
 *   - memory-files.ts   — Filesystem-based memory operations
 */

import fs from 'fs';
import path from 'path';

import type { MemoryContext } from './memory-types';
import { JANUS_DIR, MEMORY_DB, getDb, closeDb } from './db-connection';

// Re-export DB lifecycle
export { closeDb };

// Re-export all CRUD operations
export {
  getPreference,
  setPreference,
  getAllPreferences,
  getProjectKnowledge,
  setProjectKnowledge,
  indexMemory,
  searchMemoryIndex,
  saveConversationSummary,
  markRecalled,
  isRecalled,
  clearRecallTracking,
} from './memory-crud';

// Re-export filesystem operations
export {
  loadResidentMemory,
  appendToMemoryMd,
  appendDailyLog,
} from './memory-files';

// ---- Constants ----

const MEMORY_MD = 'MEMORY.md';
const MEMORY_DIR = 'memory';

// ---- Initialization ----

export function initMemoryContext(workspacePath: string, sessionId: string): MemoryContext {
  const projectPath = workspacePath;
  const dbPath = path.join(JANUS_DIR, MEMORY_DB);

  // Ensure ~/.janus/ and ~/.janus/memory/ exist
  if (!fs.existsSync(JANUS_DIR)) {
    fs.mkdirSync(JANUS_DIR, { recursive: true });
  }
  const memoryDir = path.join(JANUS_DIR, MEMORY_DIR);
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  // Ensure MEMORY.md exists
  const persistentPath = path.join(JANUS_DIR, MEMORY_MD);
  if (!fs.existsSync(persistentPath)) {
    fs.writeFileSync(persistentPath, `# Kavis Memory Index\n\n> Auto-generated memory index. Do not edit manually unless you know what you're doing.\n\n## Preferences\n\n## Facts\n\n## Patterns\n\n## Skills\n`, 'utf-8');
  }

  // Initialize DB
  getDb(dbPath);

  return {
    persistentPath,
    memoryDir,
    dbPath,
    projectPath,
    sessionId,
    alreadySurfaced: new Set(),
  };
}

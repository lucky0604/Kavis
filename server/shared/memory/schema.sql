-- Janus Memory System Schema
-- SQLite tables for persistent memory, project knowledge, and recall tracking

-- User preferences (global, cross-project)
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',  -- coding/writing/interaction/general
  confidence REAL DEFAULT 0.5,      -- 0-1, higher = more certain
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Project-specific knowledge
CREATE TABLE IF NOT EXISTS project_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',  -- tech_stack/structure/decisions/conventions
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_path, key)
);

-- Memory index for full-text search (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_index USING fts5(
  content,
  source,         -- 'MEMORY.md' / 'daily_log' / 'conversation'
  project_path,
  keywords,       -- comma-separated keywords
  category,       -- 'fact' / 'preference' / 'procedure' / 'pattern'
  created_at
);

-- Conversation summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_path TEXT,
  summary TEXT NOT NULL,
  key_decisions TEXT,               -- JSON array
  tools_used TEXT,                  -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recall tracking (prevent duplicate injection)
CREATE TABLE IF NOT EXISTS recall_tracking (
  session_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  recalled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, memory_id)
);

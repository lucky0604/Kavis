/**
 * Session Memory — In-process working memory for the current session.
 *
 * Tracks per-session state: alreadySurfaced memory IDs, turn-level
 * observations, and flush triggers. Lightweight, not persisted across
 * server restarts (that's what persistent-memory.ts is for).
 */

import type { MemoryContext, FlushData } from './memory-types';
import { appendDailyLog, indexMemory, setPreference } from './persistent-memory';

export class SessionMemory {
  private ctx: MemoryContext;
  private observations: string[] = [];
  private pendingFlush: FlushData | null = null;

  constructor(ctx: MemoryContext) {
    this.ctx = ctx;
  }

  get context(): MemoryContext {
    return this.ctx;
  }

  /**
   * Record an observation from the current turn.
   * Will be flushed to persistent storage when memory flush triggers.
   */
  observe(text: string): void {
    this.observations.push(text);
  }

  /**
   * Record a user preference observed during conversation.
   */
  recordPreference(key: string, value: string, category = 'general', confidence = 0.5): void {
    setPreference(key, value, category, confidence, this.ctx.dbPath);
    this.observe(`Preference: ${key} = ${value} (${category}, confidence: ${confidence})`);
  }

  /**
   * Mark a memory as surfaced in this session.
   */
  markSurfaced(memoryId: string): void {
    this.ctx.alreadySurfaced.add(memoryId);
  }

  /**
   * Check if a memory has already been surfaced.
   */
  isSurfaced(memoryId: string): boolean {
    return this.ctx.alreadySurfaced.has(memoryId);
  }

  /**
   * Flush current observations to persistent storage.
   * Called before context compression (Layer 3 trigger).
   */
  flush(): void {
    if (this.observations.length === 0) return;

    // Write observations to daily log
    for (const obs of this.observations) {
      appendDailyLog(this.ctx.memoryDir, obs);
    }

    // Index significant observations in FTS5
    for (const obs of this.observations) {
      if (obs.length > 20) {  // Skip trivially short observations
        indexMemory(
          obs,
          'conversation',
          this.ctx.projectPath,
          extractKeywords(obs),
          'context',
          this.ctx.dbPath
        );
      }
    }

    this.observations = [];
  }

  /**
   * Queue a flush data payload (from LLM extraction).
   * Will be committed asynchronously.
   */
  queueFlush(data: FlushData): void {
    this.pendingFlush = data;
  }

  /**
   * Commit queued flush data to persistent storage.
   */
  commitFlush(): void {
    if (!this.pendingFlush) return;

    const data = this.pendingFlush;
    this.pendingFlush = null;

    // Write facts to MEMORY.md and index
    for (const fact of data.facts) {
      appendDailyLog(this.ctx.memoryDir, `FACT: ${fact}`);
      indexMemory(fact, 'conversation', this.ctx.projectPath, extractKeywords(fact), 'fact', this.ctx.dbPath);
    }

    // Write preferences to SQLite + daily log
    for (const pref of data.preferences) {
      appendDailyLog(this.ctx.memoryDir, `PREF: ${pref}`);
      indexMemory(pref, 'conversation', this.ctx.projectPath, extractKeywords(pref), 'preference', this.ctx.dbPath);
    }

    // Write procedures
    for (const proc of data.procedures) {
      appendDailyLog(this.ctx.memoryDir, `PROC: ${proc}`);
      indexMemory(proc, 'conversation', this.ctx.projectPath, extractKeywords(proc), 'procedure', this.ctx.dbPath);
    }

    // Write daily observations
    for (const obs of data.dailyObservations) {
      appendDailyLog(this.ctx.memoryDir, obs);
    }
  }

  /**
   * Get all observations from this session (for debugging/display).
   */
  getObservations(): readonly string[] {
    return this.observations;
  }
}

// ---- Helpers ----

/**
 * Simple keyword extraction: split on whitespace and punctuation,
 * take significant tokens (>3 chars), dedupe, limit to 10.
 */
function extractKeywords(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);

  const unique = [...new Set(tokens)].slice(0, 10);
  return unique.join(',');
}

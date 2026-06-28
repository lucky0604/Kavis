/**
 * Memory Recall — Layer 2 (Per-Turn Retrieval)
 *
 * Called each turn before the LLM call. Searches FTS5 index for
 * relevant memories, filters already-surfaced entries, and returns
 * up to 5 results with staleness warnings.
 */

import type { MemoryContext, RecallResult } from './memory-types';
import { searchMemoryIndex, markRecalled, isRecalled } from './persistent-memory';

const MAX_RECALL_RESULTS = 5;
const STALENESS_WARN_DAYS = 30;

/**
 * Recall relevant memories for the current user message.
 * Layer 2: Per-Turn retrieval with dedup and staleness warnings.
 */
export function recallMemories(
  userMessage: string,
  ctx: MemoryContext
): RecallResult[] {
  if (!userMessage || userMessage.trim().length === 0) return [];

  // 1. FTS5 full-text search
  const candidates = searchMemoryIndex(
    sanitizeQuery(userMessage),
    ctx.projectPath,
    MAX_RECALL_RESULTS * 3,  // Fetch more than needed for filtering
    ctx.dbPath
  );

  // 2. Filter already-surfaced memories
  const filtered = candidates.filter((c) => {
    const id = String(c.rowid);
    if (ctx.alreadySurfaced.has(id)) return false;
    if (isRecalled(ctx.sessionId, id, ctx.dbPath)) return false;
    return true;
  });

  // 3. Select top results
  const selected = filtered.slice(0, MAX_RECALL_RESULTS);

  // 4. Mark as surfaced + track in DB
  const results: RecallResult[] = selected.map((entry) => {
    const id = String(entry.rowid);
    ctx.alreadySurfaced.add(id);
    markRecalled(ctx.sessionId, id, ctx.dbPath);

    const createdAt = new Date(entry.created_at);
    const stalenessDays = Math.floor(
      (Date.now() - createdAt.getTime()) / 86400000
    );

    return {
      id,
      content: entry.content,
      category: entry.category,
      source: entry.source,
      createdAt: entry.created_at,
      stalenessDays,
    };
  });

  return results;
}

/**
 * Format recalled memories for injection into the message stream.
 * Follows Claude Code's format with staleness warnings.
 */
export function formatRecalledMemories(memories: RecallResult[]): string {
  if (memories.length === 0) return '';

  const lines = ['[Relevant memories recalled]'];

  for (const m of memories) {
    let line = `- ${m.content}`;
    if (m.stalenessDays > 0) {
      line += ` (${m.stalenessDays} day${m.stalenessDays !== 1 ? 's' : ''} ago)`;
    }
    lines.push(line);

    // Staleness warning for old memories
    if (m.stalenessDays >= STALENESS_WARN_DAYS) {
      lines.push(`  ⚠ This memory is ${m.stalenessDays} days old. Verify against current state before asserting as fact.`);
    }
  }

  return lines.join('\n');
}

/**
 * FTS5 query sanitizer — removes special characters that could
 * break FTS5 syntax while preserving meaningful search terms.
 */
function sanitizeQuery(input: string): string {
  // Remove FTS5 operators and special chars
  let query = input
    .replace(/[{}()*+"|:]/g, ' ')
    .replace(/\band\b/gi, ' ')
    .replace(/\bor\b/gi, ' ')
    .replace(/\bnot\b/gi, ' ')
    .replace(/\bnear\b/gi, ' ')
    .trim();

  // Split into tokens and join with OR for broader recall
  const tokens = query.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return '';

  // Use OR matching for broader recall
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

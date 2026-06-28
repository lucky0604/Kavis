/**
 * Memory Flush — Layer 3 (凝练层 trigger)
 *
 * Triggered before context compression. Extracts key facts,
 * preferences, and procedures from the conversation, then
 * writes them to persistent storage asynchronously.
 *
 * Design: Does NOT block the conversation stream. If the flush
 * doesn't complete before compression, that turn's facts may
 * be lost — this is acceptable (not catastrophic).
 */

import type { Message } from '../../../shared/types';
import type { MemoryContext, FlushData } from './memory-types';
import { SessionMemory } from './session-memory';
import { appendToMemoryMd, appendDailyLog, indexMemory } from './persistent-memory';

/**
 * Extract flush-worthy data from conversation messages.
 * Uses simple heuristic extraction (no LLM call needed for basic flush).
 * For deeper LLM-based extraction, see memory-consolidation.ts.
 */
export function extractFlushData(messages: Message[]): FlushData {
  const facts: string[] = [];
  const preferences: string[] = [];
  const procedures: string[] = [];
  const dailyObservations: string[] = [];

  for (const msg of messages) {
    const content = msg.content;
    if (!content || msg.role === 'tool') continue;

    // Heuristic: extract patterns from user and assistant messages
    extractFromText(content, facts, preferences, procedures, dailyObservations);
  }

  return { facts, preferences, procedures, dailyObservations };
}

/**
 * Perform an asynchronous memory flush.
 * Called before context compression — does not block.
 */
export function asyncMemoryFlush(
  messages: Message[],
  sessionMemory: SessionMemory
): void {
  // Extract and queue (actual write happens in commitFlush)
  const data = extractFlushData(messages);
  if (data.facts.length > 0 || data.preferences.length > 0 || data.procedures.length > 0) {
    sessionMemory.queueFlush(data);
    // Commit immediately (could be deferred to next idle moment)
    sessionMemory.commitFlush();
  }

  // Also flush any pending observations
  sessionMemory.flush();
}

/**
 * Perform a deeper flush using LLM-based extraction.
 * Used by consolidation (periodic), not per-compression.
 */
export async function llmMemoryFlush(
  messages: Message[],
  ctx: MemoryContext,
  extractFn: (messages: Message[]) => Promise<FlushData>
): Promise<void> {
  try {
    const data = await extractFn(messages);
    commitFlushData(data, ctx);
  } catch (err) {
    // Flush failures are non-critical — don't crash, but log for diagnosis.
    console.error('[Kavis memory] llmMemoryFlush failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Commit flush data directly to persistent storage.
 */
export function commitFlushData(data: FlushData, ctx: MemoryContext): void {
  // Write facts to MEMORY.md Facts section
  for (const fact of data.facts) {
    appendToMemoryMd(ctx.persistentPath, 'Facts', `- ${fact}`);
    indexMemory(fact, 'conversation', ctx.projectPath, extractKeywords(fact), 'fact', ctx.dbPath);
  }

  // Write preferences to MEMORY.md Preferences section
  for (const pref of data.preferences) {
    appendToMemoryMd(ctx.persistentPath, 'Preferences', `- ${pref}`);
    indexMemory(pref, 'conversation', ctx.projectPath, extractKeywords(pref), 'preference', ctx.dbPath);
  }

  // Write procedures to MEMORY.md Patterns section
  for (const proc of data.procedures) {
    appendToMemoryMd(ctx.persistentPath, 'Patterns', `- ${proc}`);
    indexMemory(proc, 'conversation', ctx.projectPath, extractKeywords(proc), 'procedure', ctx.dbPath);
  }

  // Write daily observations
  for (const obs of data.dailyObservations) {
    appendDailyLog(ctx.memoryDir, obs);
  }
}

// ---- Heuristic Extraction ----

function extractFromText(
  text: string,
  facts: string[],
  preferences: string[],
  procedures: string[],
  observations: string[]
): void {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;  // Skip trivial lines

    // Pattern: "I prefer/like/want X"
    if (/\b(I prefer|I like|I want|I always|I never|I usually)\b/i.test(trimmed)) {
      preferences.push(trimmed.slice(0, 200));
      continue;
    }

    // Pattern: "Step 1/N:", "First,", "Then,", numbered procedures
    if (/\b(Step \d|First,|Then,|Next,|Finally,)\b/i.test(trimmed)) {
      procedures.push(trimmed.slice(0, 200));
      continue;
    }

    // Pattern: factual statements with technical terms
    if (/\b(uses|built with|runs on|depends on|configured|version)\b/i.test(trimmed)) {
      facts.push(trimmed.slice(0, 200));
      continue;
    }

    // Pattern: observations for daily log
    if (/\b(fixed|added|removed|updated|changed|discovered)\b/i.test(trimmed)) {
      observations.push(trimmed.slice(0, 200));
    }
  }
}

// ---- Helpers ----

function extractKeywords(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);
  const unique = [...new Set(tokens)].slice(0, 10);
  return unique.join(',');
}

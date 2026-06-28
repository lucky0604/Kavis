/**
 * Memory Consolidation — Layer 3 (凝练层)
 *
 * Periodic background process that:
 * 1. Scans recent daily logs (last 7 days)
 * 2. Extracts knowledge worth keeping long-term
 * 3. Updates MEMORY.md with consolidated facts
 * 4. Removes stale entries from MEMORY.md
 * 5. Rebuilds FTS5 index for consolidated entries
 *
 * Triggered: Daily (timer) or user manual trigger.
 * Can also use LLM for deeper extraction if configured.
 */

import fs from 'fs';
import path from 'path';
import type { MemoryContext, FlushData } from './memory-types';
import { appendToMemoryMd, indexMemory } from './persistent-memory';

const CONSOLIDATION_WINDOW_DAYS = 7;

/**
 * Run memory consolidation over recent daily logs.
 * This is a heuristic-only consolidation (no LLM call).
 * For LLM-based consolidation, use consolidateWithLLM.
 */
export function consolidateMemory(ctx: MemoryContext): ConsolidationReport {
  const report: ConsolidationReport = {
    logsScanned: 0,
    factsAdded: 0,
    preferencesAdded: 0,
    staleEntriesRemoved: 0,
    errors: [],
  };

  try {
    // 1. Scan recent daily logs
    const recentLogs = scanRecentLogs(ctx.memoryDir, CONSOLIDATION_WINDOW_DAYS);
    report.logsScanned = recentLogs.length;

    if (recentLogs.length === 0) return report;

    // 2. Extract knowledge from logs
    for (const log of recentLogs) {
      const data = extractFromLog(log.content);
      
      // Write consolidated facts to MEMORY.md
      for (const fact of data.facts) {
        appendToMemoryMd(ctx.persistentPath, 'Facts', `- ${fact}`);
        indexMemory(fact, 'daily_log', ctx.projectPath, extractKeywords(fact), 'fact', ctx.dbPath);
        report.factsAdded++;
      }

      for (const pref of data.preferences) {
        appendToMemoryMd(ctx.persistentPath, 'Preferences', `- ${pref}`);
        indexMemory(pref, 'daily_log', ctx.projectPath, extractKeywords(pref), 'preference', ctx.dbPath);
        report.preferencesAdded++;
      }
    }

    // 3. Trim MEMORY.md if over size limit
    const trimmed = trimMemoryMd(ctx.persistentPath);
    report.staleEntriesRemoved = trimmed;
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : 'Unknown error');
  }

  return report;
}

/**
 * Consolidate with LLM-based extraction.
 * The extractFn is provided by the caller (who has access to the AI adapter).
 */
export async function consolidateWithLLM(
  ctx: MemoryContext,
  extractFn: (logContent: string) => Promise<FlushData>
): Promise<ConsolidationReport> {
  const report: ConsolidationReport = {
    logsScanned: 0,
    factsAdded: 0,
    preferencesAdded: 0,
    staleEntriesRemoved: 0,
    errors: [],
  };

  try {
    const recentLogs = scanRecentLogs(ctx.memoryDir, CONSOLIDATION_WINDOW_DAYS);
    report.logsScanned = recentLogs.length;

    for (const log of recentLogs) {
      try {
        const data = await extractFn(log.content);

        for (const fact of data.facts) {
          appendToMemoryMd(ctx.persistentPath, 'Facts', `- ${fact}`);
          indexMemory(fact, 'daily_log', ctx.projectPath, extractKeywords(fact), 'fact', ctx.dbPath);
          report.factsAdded++;
        }

        for (const pref of data.preferences) {
          appendToMemoryMd(ctx.persistentPath, 'Preferences', `- ${pref}`);
          indexMemory(pref, 'daily_log', ctx.projectPath, extractKeywords(pref), 'preference', ctx.dbPath);
          report.preferencesAdded++;
        }
      } catch (err) {
        report.errors.push(`Log ${log.date}: ${err instanceof Error ? err.message : 'extraction failed'}`);
      }
    }

    const trimmed = trimMemoryMd(ctx.persistentPath);
    report.staleEntriesRemoved = trimmed;
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : 'Unknown error');
  }

  return report;
}

// ---- Types ----

export interface ConsolidationReport {
  logsScanned: number;
  factsAdded: number;
  preferencesAdded: number;
  staleEntriesRemoved: number;
  errors: string[];
}

interface DailyLog {
  date: string;
  content: string;
}

// ---- Helpers ----

function scanRecentLogs(memoryDir: string, days: number): DailyLog[] {
  const logs: DailyLog[] = [];
  const now = Date.now();

  for (let i = 0; i < days; i++) {
    const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
    const logPath = path.join(memoryDir, `${date}.md`);

    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        logs.push({ date, content });
      } catch (err) {
        // Skip unreadable logs but log so we know which ones failed
        console.error(`[Kavis memory] daily log ${date} unreadable:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return logs;
}

function extractFromLog(content: string): FlushData {
  const facts: string[] = [];
  const preferences: string[] = [];
  const procedures: string[] = [];
  const dailyObservations: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;

    // Lines starting with "FACT:" or "PREF:" are explicitly tagged
    if (trimmed.startsWith('FACT:')) {
      facts.push(trimmed.slice(5).trim());
    } else if (trimmed.startsWith('PREF:')) {
      preferences.push(trimmed.slice(5).trim());
    } else if (trimmed.startsWith('PROC:')) {
      procedures.push(trimmed.slice(5).trim());
    } else if (trimmed.startsWith('- [') && trimmed.includes(']')) {
      // Timestamped observation: "- [HH:MM:SS] content"
      const contentStart = trimmed.indexOf('] ') + 2;
      if (contentStart > 1) {
        dailyObservations.push(trimmed.slice(contentStart));
      }
    }
  }

  return { facts, preferences, procedures, dailyObservations };
}

/**
 * Trim MEMORY.md if it exceeds the line limit.
 * Removes oldest entries from each section, preserving headers.
 * Returns the number of lines removed.
 */
function trimMemoryMd(persistentPath: string): number {
  try {
    const content = fs.readFileSync(persistentPath, 'utf-8');
    const lines = content.split('\n');

    if (lines.length <= 200) return 0;

    // Find each section and trim from the top of each
    const sections: { header: number; start: number; end: number }[] = [];
    let currentHeader = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        if (currentHeader >= 0) {
          sections[sections.length - 1].end = i;
        }
        sections.push({ header: i, start: i + 1, end: lines.length });
        currentHeader = sections.length - 1;
      }
    }

    // Remove lines from the beginning of each section to get under 200
    let removed = 0;
    while (lines.length - removed > 200) {
      // Find the section with the most entries and remove one from its top
      let longestSection = -1;
      let longestLength = 0;

      for (let i = 0; i < sections.length; i++) {
        const length = sections[i].end - sections[i].start;
        if (length > longestLength && !lines[sections[i].start]?.startsWith('#')) {
          longestLength = length;
          longestSection = i;
        }
      }

      if (longestSection === -1 || longestLength <= 1) break;

      // Remove one line from the top of that section
      lines.splice(sections[longestSection].start, 1);
      removed++;

      // Adjust section boundaries
      for (let i = longestSection; i < sections.length; i++) {
        sections[i].end--;
        if (i > longestSection) {
          sections[i].header--;
          sections[i].start--;
        }
      }
    }

    if (removed > 0) {
      const tmp = persistentPath + '.tmp.' + Date.now();
      fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
      fs.renameSync(tmp, persistentPath);
    }

    return removed;
  } catch (err) {
    console.error('[Kavis memory] trimMemoryMd failed:', err instanceof Error ? err.message : err);
    return 0;
  }
}

function extractKeywords(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);
  return [...new Set(tokens)].slice(0, 10).join(',');
}

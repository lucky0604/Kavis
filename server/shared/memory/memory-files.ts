/**
 * Memory Files — Filesystem-based memory operations.
 *
 * Handles MEMORY.md resident index, daily logs, and atomic file writes.
 * Internal module. All public exports are re-exported from persistent-memory.ts.
 */

import fs from 'fs';
import path from 'path';
import type { MemoryContext } from './memory-types';

const MAX_MEMORY_MD_SIZE = 25_000; // 25KB hard limit
const MAX_MEMORY_MD_LINES = 200;

// ---- Layer 1: 常驻层 (Session-Start) ----

/**
 * Load the resident memory layer: MEMORY.md index + today/yesterday daily logs.
 * Called once at session start, injected into system prompt.
 */
export function loadResidentMemory(ctx: MemoryContext): string {
  const parts: string[] = [];

  // 1. MEMORY.md index (truncated to 25KB / 200 lines)
  const memoryMd = loadMemoryMd(ctx.persistentPath);
  if (memoryMd) {
    parts.push('## Memory Index\n' + memoryMd);
  }

  // 2. Today's daily log
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = loadDailyLog(ctx.memoryDir, today);
  if (todayLog) {
    parts.push(`## Today's Log (${today})\n` + todayLog);
  }

  // 3. Yesterday's daily log
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yesterdayLog = loadDailyLog(ctx.memoryDir, yesterday);
  if (yesterdayLog) {
    parts.push(`## Yesterday's Log (${yesterday})\n` + yesterdayLog);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

// ---- Internal helpers ----

function loadMemoryMd(persistentPath: string): string {
  try {
    let content = fs.readFileSync(persistentPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > MAX_MEMORY_MD_LINES) {
      content = lines.slice(0, MAX_MEMORY_MD_LINES).join('\n') + '\n... [truncated]';
    }
    if (Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_MD_SIZE) {
      content = content.slice(0, MAX_MEMORY_MD_SIZE) + '\n... [truncated]';
    }
    return content;
  } catch {
    return '';
  }
}

function loadDailyLog(memoryDir: string, date: string): string {
  const logPath = path.join(memoryDir, `${date}.md`);
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

// ---- MEMORY.md Write ----

/**
 * Append content to MEMORY.md (used by consolidation).
 * Respects the size limit.
 */
export function appendToMemoryMd(persistentPath: string, section: string, content: string): void {
  try {
    let existing = fs.readFileSync(persistentPath, 'utf-8');

    // Find the section header
    const sectionHeader = `## ${section}`;
    const sectionIdx = existing.indexOf(sectionHeader);

    if (sectionIdx !== -1) {
      // Find the next section header
      const afterSection = sectionIdx + sectionHeader.length;
      const nextSectionIdx = existing.indexOf('\n## ', afterSection);

      const insertPoint = nextSectionIdx !== -1 ? nextSectionIdx : existing.length;
      const before = existing.slice(0, insertPoint);
      const after = existing.slice(insertPoint);

      existing = before + '\n' + content + '\n' + after;
    } else {
      // Section doesn't exist, append at end
      existing += `\n${sectionHeader}\n\n${content}\n`;
    }

    // Enforce size limit
    const lines = existing.split('\n');
    if (lines.length > MAX_MEMORY_MD_LINES) {
      // Remove oldest entries (skip header lines)
      const headerEnd = existing.indexOf('\n## Preferences');
      if (headerEnd !== -1) {
        const header = existing.slice(0, headerEnd);
        const body = existing.slice(headerEnd);
        const bodyLines = body.split('\n');
        const trimmed = bodyLines.slice(bodyLines.length - MAX_MEMORY_MD_LINES).join('\n');
        existing = header + trimmed;
      }
    }

    atomicWrite(persistentPath, existing);
  } catch (err) {
    // Fail silently — memory writes should not crash the agent loop.
    console.error('[Kavis memory] appendToMemoryMd failed:', err instanceof Error ? err.message : err);
  }
}

// ---- Daily Log Write ----

/**
 * Append an observation to today's daily log.
 */
export function appendDailyLog(memoryDir: string, content: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(memoryDir, `${today}.md`);

  let existing = '';
  if (fs.existsSync(logPath)) {
    existing = fs.readFileSync(logPath, 'utf-8');
  } else {
    existing = `# Daily Log — ${today}\n\n`;
  }

  const timestamp = new Date().toISOString().slice(11, 19);
  existing += `- [${timestamp}] ${content}\n`;

  atomicWrite(logPath, existing);
}

// ---- Helpers ----

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

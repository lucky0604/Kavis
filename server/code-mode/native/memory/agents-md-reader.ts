import fs from 'fs';
import path from 'path';
import type { Message } from '../../../../shared/types';

export const MAX_PROJECT_RULES_BYTES = 50 * 1024;

const PROJECT_RULES_MARKER = '[Project Rules]';

export function projectRulesMarker(): string {
  return PROJECT_RULES_MARKER;
}

export function hasProjectRulesMessage(content: string): boolean {
  return content.includes(PROJECT_RULES_MARKER);
}

/** Resolve AGENTS.md (preferred) or CLAUDE.md path, or null if neither exists. */
export function findProjectRulesPath(workspacePath: string): string | null {
  const agentsPath = path.join(workspacePath, 'AGENTS.md');
  const claudePath = path.join(workspacePath, 'CLAUDE.md');
  if (fs.existsSync(agentsPath)) return agentsPath;
  if (fs.existsSync(claudePath)) return claudePath;
  return null;
}

/**
 * Insert or replace the dedicated [Project Rules] system message.
 * Pass `rules: null` to remove the message when the rules file is deleted.
 */
export function upsertProjectRulesMessage(messages: Message[], rules: string | null): Message[] {
  const rulesIdx = messages.findIndex(
    (m) => m.role === 'system' && hasProjectRulesMessage(m.content),
  );

  if (rules === null) {
    if (rulesIdx >= 0) return messages.filter((_, i) => i !== rulesIdx);
    return messages;
  }

  const content = `${projectRulesMarker()}\n${rules}`;
  if (rulesIdx >= 0) {
    const updated = [...messages];
    updated[rulesIdx] = { ...messages[rulesIdx], content };
    return updated;
  }

  const firstSystem = messages.findIndex((m) => m.role === 'system');
  const rulesMessage: Message = {
    id: crypto.randomUUID(),
    role: 'system',
    content,
    timestamp: Date.now(),
  };

  if (firstSystem >= 0) {
    const insertAt = firstSystem + 1;
    return [...messages.slice(0, insertAt), rulesMessage, ...messages.slice(insertAt)];
  }
  return [rulesMessage, ...messages];
}

/**
 * Read AGENTS.md (preferred) or CLAUDE.md from workspace root.
 * Truncates to MAX_PROJECT_RULES_BYTES to avoid context blow-up.
 */
export async function readProjectRules(workspacePath: string): Promise<string | null> {
  try {
    const target = findProjectRulesPath(workspacePath);
    if (!target) return null;

    const stat = await fs.promises.stat(target);
    const readLen = Math.min(stat.size, MAX_PROJECT_RULES_BYTES);
    const handle = await fs.promises.open(target, 'r');
    try {
      const buffer = Buffer.alloc(readLen);
      await handle.read(buffer, 0, readLen, 0);
      let content = buffer.toString('utf-8').trim();
      if (stat.size > MAX_PROJECT_RULES_BYTES) {
        content += `\n\n[Truncated: file exceeds ${MAX_PROJECT_RULES_BYTES} bytes]`;
      }
      return content || null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

import type { Message, SessionMeta } from '../../../shared/types';

export function deriveSessionName(messages: Message[], sessionId: string): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser?.content) {
    const trimmed = firstUser.content.trim().replace(/\s+/g, ' ');
    return trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed;
  }
  return `Session ${sessionId.slice(0, 8)}`;
}

const PLACEHOLDER_NAME_RE = /^Session [0-9a-f]{8}$/;

export function isPlaceholderName(name: string | undefined): boolean {
  return !name || PLACEHOLDER_NAME_RE.test(name);
}

export function shouldUpgradeName(meta: SessionMeta): boolean {
  if (meta.nameSource === 'manual' || meta.nameSource === 'llm') return false;
  if (isPlaceholderName(meta.name)) return true;
  if (meta.nameSource === 'snippet') return true;
  if (!meta.nameSource) return true;
  return false;
}

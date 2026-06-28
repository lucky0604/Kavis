import fs from 'fs';
import path from 'path';
import type { Message, SessionMeta, DialogTurn, SessionListScope } from '../../../shared/types';
import { sessionMatchesScope } from '../../../shared/types';
import { SESSIONS_DIR, normalizeWorkspacePath, ensureDir, atomicWrite } from './file-utils';
import { deriveSessionName, isPlaceholderName, shouldUpgradeName } from './session-names';
import { removeFromIndex, updateIndex } from './index-manager';

export { shouldUpgradeName } from './session-names';

export interface ListSessionsOptions {
  workspacePath?: string;
  scope?: SessionListScope;
}

export async function saveSession(
  sessionId: string,
  messages: Message[],
  agentType: string,
  workspacePath?: string
): Promise<void> {
  await upsertSession(sessionId, messages, agentType, workspacePath);
}

export async function loadSession(sessionId: string): Promise<{ messages: Message[]; metadata: SessionMeta } | null> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(dir)) return null;

  try {
    const metadata: SessionMeta = JSON.parse(
      fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8')
    );

    const messages: Message[] = [];
    const turnsDir = path.join(dir, 'turns');
    if (fs.existsSync(turnsDir)) {
      const files = fs.readdirSync(turnsDir)
        .filter((f) => f.startsWith('turn-') && f.endsWith('.json'))
        .sort();

      for (const file of files) {
        const turn: DialogTurn = JSON.parse(
          fs.readFileSync(path.join(turnsDir, file), 'utf-8')
        );
        messages.push(...turn.messages);
      }
    }

    return { messages, metadata };
  } catch {
    return null;
  }
}

export async function listSessions(options?: ListSessionsOptions | string): Promise<SessionMeta[]> {
  const opts: ListSessionsOptions =
    typeof options === 'string' ? { workspacePath: options } : (options ?? {});

  ensureDir(SESSIONS_DIR);

  const indexFile = path.join(SESSIONS_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) return [];

  let sessions: SessionMeta[] = [];
  try {
    sessions = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
  } catch {}

  if (opts.scope) {
    sessions = sessions.filter((s) => sessionMatchesScope(s.agentType, opts.scope!));
  }

  if (opts.workspacePath) {
    const normalized = normalizeWorkspacePath(opts.workspacePath)!;
    sessions = sessions.filter(
      (s) => s.projectPath && normalizeWorkspacePath(s.projectPath) === normalized,
    );
  }

  return sessions;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await removeFromIndex(sessionId);
}

export async function createEmptySession(
  sessionId: string,
  agentType: string,
  workspacePath?: string,
  name?: string,
): Promise<SessionMeta> {
  return upsertSession(sessionId, [], agentType, workspacePath, name);
}

export async function upsertSession(
  sessionId: string,
  messages: Message[],
  agentType: string,
  workspacePath?: string,
  sessionName?: string,
): Promise<SessionMeta> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  ensureDir(dir);

  const metadataPath = path.join(dir, 'metadata.json');
  let metadata: SessionMeta;

  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    metadata.lastActiveAt = new Date().toISOString();
    metadata.messageCount = messages.length;
    metadata.agentType = agentType;
    if (workspacePath) metadata.projectPath = normalizeWorkspacePath(workspacePath);

    if (sessionName) {
      metadata.name = sessionName;
      metadata.nameSource = 'manual';
    } else if (shouldUpgradeName(metadata) && messages.some((m) => m.role === 'user')) {
      const snippet = deriveSessionName(messages, sessionId);
      if (!isPlaceholderName(snippet)) {
        metadata.name = snippet;
        metadata.nameSource = 'snippet';
      }
    }
  } else {
    const hasUser = messages.some((m) => m.role === 'user');
    const derivedName = sessionName || deriveSessionName(messages, sessionId);
    metadata = {
      sessionId,
      name: derivedName,
      nameSource: sessionName
        ? 'manual'
        : hasUser && !isPlaceholderName(derivedName)
          ? 'snippet'
          : 'placeholder',
      agentType,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      turnCount: 1,
      messageCount: messages.length,
      ...(workspacePath && { projectPath: normalizeWorkspacePath(workspacePath) }),
    };
  }

  atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));

  const turnsDir = path.join(dir, 'turns');
  ensureDir(turnsDir);

  // Snapshot mode: Code Mode (and similar callers) always send the complete
  // message array. Writing incremental turn files causes duplication on load.
  // Fix: overwrite a single turn-0000 snapshot, removing any stale turn files.
  const existingTurns = fs.existsSync(turnsDir)
    ? fs.readdirSync(turnsDir).filter((f) => /^turn-\d{4}\.json$/.test(f))
    : [];
  for (const old of existingTurns) {
    if (old !== 'turn-0000.json') {
      try { fs.unlinkSync(path.join(turnsDir, old)); } catch { /* ignore */ }
    }
  }

  const turn: DialogTurn = {
    turnId: crypto.randomUUID(),
    turnIndex: 0,
    messages,
    startTime: metadata.createdAt,
    endTime: new Date().toISOString(),
  };
  metadata.turnCount = 1;

  atomicWrite(path.join(turnsDir, 'turn-0000.json'), JSON.stringify(turn, null, 2));

  await updateIndex(sessionId, metadata);
  return metadata;
}

export async function getSessionMetadata(sessionId: string): Promise<SessionMeta | null> {
  const metadataPath = path.join(SESSIONS_DIR, sessionId, 'metadata.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as SessionMeta;
  } catch {
    return null;
  }
}

export async function updateSessionName(
  sessionId: string,
  name: string,
  source: NonNullable<SessionMeta['nameSource']>,
): Promise<SessionMeta | null> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  const metadataPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) return null;

  const cleaned = name.trim();
  if (!cleaned) return null;

  let metadata: SessionMeta;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as SessionMeta;
  } catch {
    return null;
  }

  if (source !== 'manual' && (metadata.nameSource === 'manual' || metadata.nameSource === 'llm')) {
    return metadata;
  }

  metadata.name = cleaned;
  metadata.nameSource = source;
  metadata.lastActiveAt = new Date().toISOString();
  atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));
  await updateIndex(sessionId, metadata);
  return metadata;
}

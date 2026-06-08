import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Message, SessionMeta, DialogTurn } from '../../shared/types';

const SESSIONS_DIR = path.join(os.homedir(), '.janus', 'sessions');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

export async function saveSession(
  sessionId: string,
  messages: Message[],
  agentType: string
): Promise<void> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  ensureDir(dir);

  const metadata: SessionMeta = {
    sessionId,
    name: `Session ${sessionId.slice(0, 8)}`,
    agentType,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    turnCount: 1,
    messageCount: messages.length,
  };

  atomicWrite(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const turn: DialogTurn = {
    turnId: crypto.randomUUID(),
    turnIndex: 0,
    messages,
    startTime: new Date().toISOString(),
  };

  const turnFile = path.join(dir, 'turns', 'turn-0000.json');
  ensureDir(path.join(dir, 'turns'));
  atomicWrite(turnFile, JSON.stringify(turn, null, 2));

  updateIndex(sessionId, metadata);
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

export async function listSessions(): Promise<SessionMeta[]> {
  ensureDir(SESSIONS_DIR);

  const indexFile = path.join(SESSIONS_DIR, 'index.json');
  if (fs.existsSync(indexFile)) {
    try {
      return JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    } catch {}
  }
  return [];
}

export async function deleteSession(sessionId: string): Promise<void> {
  const dir = path.join(SESSIONS_DIR, sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function updateIndex(sessionId: string, metadata: SessionMeta): void {
  ensureDir(SESSIONS_DIR);
  const indexFile = path.join(SESSIONS_DIR, 'index.json');

  let index: SessionMeta[] = [];
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
  } catch {}

  const existingIdx = index.findIndex((s) => s.sessionId === sessionId);
  if (existingIdx >= 0) {
    index[existingIdx] = metadata;
  } else {
    index.push(metadata);
  }

  index.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  atomicWrite(indexFile, JSON.stringify(index, null, 2));
}

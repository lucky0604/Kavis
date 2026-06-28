import fs from 'fs';
import path from 'path';
import type { SessionMeta } from '../../../shared/types';
import { SESSIONS_DIR, ensureDir, atomicWrite, acquireIndexLock, releaseIndexLock } from './file-utils';

export async function removeFromIndex(sessionId: string): Promise<void> {
  await acquireIndexLock();
  try {
    ensureDir(SESSIONS_DIR);
    const indexFile = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexFile)) return;

    let index: SessionMeta[] = [];
    try {
      index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    } catch {
      return;
    }

    const filtered = index.filter((s) => s.sessionId !== sessionId);
    if (filtered.length !== index.length) {
      atomicWrite(indexFile, JSON.stringify(filtered, null, 2));
    }
  } finally {
    releaseIndexLock();
  }
}

export async function updateIndex(sessionId: string, metadata: SessionMeta): Promise<void> {
  await acquireIndexLock();
  try {
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
  } finally {
    releaseIndexLock();
  }
}

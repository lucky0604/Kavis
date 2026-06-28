import fs from 'fs';
import path from 'path';
import os from 'os';

export const SESSIONS_DIR = path.join(os.homedir(), '.janus', 'sessions');

export function normalizeWorkspacePath(workspacePath?: string): string | undefined {
  if (!workspacePath) return undefined;
  return path.resolve(workspacePath);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// --- Index write lock (prevents read-then-write races on index.json) ---
let indexWriteLocked = false;
const indexWriteQueue: Array<() => void> = [];

export function acquireIndexLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!indexWriteLocked) {
      indexWriteLocked = true;
      resolve();
    } else {
      indexWriteQueue.push(resolve);
    }
  });
}

export function releaseIndexLock(): void {
  if (indexWriteQueue.length > 0) {
    const next = indexWriteQueue.shift()!;
    setImmediate(() => next());
  } else {
    indexWriteLocked = false;
  }
}

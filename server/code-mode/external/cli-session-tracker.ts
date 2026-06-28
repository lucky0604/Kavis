import fs from 'fs';
import path from 'path';
import os from 'os';
import type { CliToolId } from '../../../shared/types';

export interface CliNativeSession {
  cliId: CliToolId;
  nativeId: string;
  capturedAt: number;
  lastTurnCompleted: boolean;
}

type CliSessionMap = Partial<Record<CliToolId, CliNativeSession>>;

const SESSIONS_DIR = path.join(os.homedir(), '.janus', 'sessions');

function atomicWrite(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function getTrackerPath(janusSessionId: string): string {
  return path.join(SESSIONS_DIR, janusSessionId, 'cli-sessions.json');
}

export function loadCliSessions(janusSessionId: string): CliSessionMap {
  const filePath = getTrackerPath(janusSessionId);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CliSessionMap;
  } catch {
    return {};
  }
}

export function saveCliSession(
  janusSessionId: string,
  cliId: CliToolId,
  nativeId: string,
): void {
  const filePath = getTrackerPath(janusSessionId);
  const existing = loadCliSessions(janusSessionId);
  existing[cliId] = {
    cliId,
    nativeId,
    capturedAt: Date.now(),
    lastTurnCompleted: false,
  };
  atomicWrite(filePath, JSON.stringify(existing, null, 2));
}

export function markTurnCompleted(
  janusSessionId: string,
  cliId: CliToolId,
): void {
  const filePath = getTrackerPath(janusSessionId);
  const existing = loadCliSessions(janusSessionId);
  if (existing[cliId]) {
    existing[cliId]!.lastTurnCompleted = true;
    atomicWrite(filePath, JSON.stringify(existing, null, 2));
  }
}

export function markTurnDirty(
  janusSessionId: string,
  cliId: CliToolId,
): void {
  const filePath = getTrackerPath(janusSessionId);
  const existing = loadCliSessions(janusSessionId);
  if (existing[cliId]) {
    existing[cliId]!.lastTurnCompleted = false;
    atomicWrite(filePath, JSON.stringify(existing, null, 2));
  }
}

export function getNativeSessionId(
  janusSessionId: string,
  cliId: CliToolId,
): CliNativeSession | undefined {
  const sessions = loadCliSessions(janusSessionId);
  return sessions[cliId];
}

export function getLastUsedCli(janusSessionId: string): CliToolId | undefined {
  const sessions = loadCliSessions(janusSessionId);
  let latest: CliNativeSession | undefined;
  for (const session of Object.values(sessions)) {
    if (!session) continue;
    if (!latest || session.capturedAt > latest.capturedAt) {
      latest = session;
    }
  }
  return latest?.cliId;
}

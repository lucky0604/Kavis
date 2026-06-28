import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.janus');
const LOG_FILE = path.join(LOG_DIR, 'errors.log');
const MAX_BYTES = 5 * 1024 * 1024;

export interface ErrorLogEntry {
  ts: string;
  source: string;
  message: string;
  kind?: string;
  status?: number;
  baseUrl?: string;
  model?: string;
  code?: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

let ensured = false;
function ensureDir(): void {
  if (ensured) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    ensured = true;
  } catch {
    // best-effort: if mkdir fails (perm/full), appendFile below will also fail and we swallow it
  }
}

/**
 * Strip secrets from arbitrary string fields before persisting.
 * Provider-agnostic — covers OpenAI/Anthropic/DeepSeek/Qwen/iSoftStone-thor/custom-gateway
 * key formats observed in the wild. ORDER MATTERS: specific patterns first,
 * generic Bearer/X-API-Key catch-all last so they don't shadow each other.
 * Never throws — falls through to input on regex failure.
 */
function redact(s: string | undefined): string | undefined {
  if (!s) return s;
  return s
    // OpenAI-style: sk-..., sk-proj-..., sk-ant-... (Anthropic), pk-..., rk-...
    // Keep first 6 chars (prefix like 'sk-ant') for debugging, redact the rest.
    .replace(/\b((?:sk|pk|rk)-[A-Za-z0-9_-]{8,})\b/g, (m) => `${m.slice(0, 6)}***REDACTED***`)
    // Generic Bearer in Authorization header — any non-whitespace token
    .replace(/(Authorization\s*:\s*Bearer\s+)\S+/gi, '$1***REDACTED***')
    // X-API-Key / X-Goog-Api-Key / X-Custom-Api-Key header style (any case)
    .replace(/(\bx-[a-z-]*api-?key\s*:\s*)\S+/gi, '$1***REDACTED***')
    // api_key=... / api-key: ... / apikey="..." in body or query
    .replace(/(\bapi[-_]?key\s*[:=]\s*)['"]?[^'",;\s&]+['"]?/gi, '$1***REDACTED***')
    // ?key=... or &access_token=... in URL query strings
    .replace(/([?&](?:api[-_]?key|access[-_]?token|token)=)[^&\s]+/gi, '$1***REDACTED***')
    // user:pass@host URL credential syntax
    .replace(/\/\/([^/@\s:]+):([^/@\s]+)@/g, '//$1:***REDACTED***@');
}

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_BYTES) return;
    const rotated = LOG_FILE + '.1';
    try { fs.unlinkSync(rotated); } catch { /* not present */ }
    fs.renameSync(LOG_FILE, rotated);
  } catch {
    // file may not exist yet — nothing to rotate
  }
}

/**
 * Fire-and-forget: schedules an async append; never blocks the request path.
 * Errors are intentionally swallowed (disk full, permissions, racing rotation)
 * since logging failure must never break user-facing flows.
 */
export function logError(entry: Omit<ErrorLogEntry, 'ts'>): void {
  ensureDir();
  rotateIfNeeded();
  const safe: ErrorLogEntry = {
    ts: new Date().toISOString(),
    source: entry.source,
    message: redact(entry.message) ?? '',
    kind: entry.kind,
    status: entry.status,
    baseUrl: redact(entry.baseUrl),
    model: entry.model,
    code: entry.code,
    stack: redact(entry.stack),
    extra: entry.extra,
  };
  const line = JSON.stringify(safe) + '\n';
  fsp.appendFile(LOG_FILE, line, 'utf8').catch(() => {
    // swallow: logging is best-effort, must not break request path
  });
}

export function getErrorLogPath(): string {
  return LOG_FILE;
}

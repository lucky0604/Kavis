import fs from 'fs';
import path from 'path';
import type { HandoffContext } from '../../../shared/types';

const HANDOFF_DIR = '.janus';
const HANDOFF_FILE = 'handoff.json';
const SCHEMA_VERSION = 1;

function handoffPath(workspacePath: string): string {
  return path.join(workspacePath, HANDOFF_DIR, HANDOFF_FILE);
}

export function readHandoff(workspacePath: string): HandoffContext | null {
  const filePath = handoffPath(workspacePath);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as HandoffContext;
    if (parsed.version !== SCHEMA_VERSION) {
      throw new Error(`Unsupported handoff version: ${parsed.version}`);
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function writeHandoff(
  workspacePath: string,
  context: HandoffContext,
): void {
  const dirPath = path.join(workspacePath, HANDOFF_DIR);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const tmpPath = handoffPath(workspacePath) + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(context, null, 2), 'utf-8');
  fs.renameSync(tmpPath, handoffPath(workspacePath));
}

export function deleteHandoff(workspacePath: string): boolean {
  const filePath = handoffPath(workspacePath);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function ensureGitignore(workspacePath: string): void {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  const entry = '.janus/';
  try {
    const content = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    if (!content.split('\n').some((line) => line.trim() === entry)) {
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}${entry}\n`);
    }
  } catch {
    // non-critical
  }
}

export function createHandoffContext(
  partial: Omit<HandoffContext, 'version' | 'timestamp'>,
): HandoffContext {
  return {
    ...partial,
    version: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
  };
}

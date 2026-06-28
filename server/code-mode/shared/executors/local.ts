import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { CodeExecutor } from './index';
import { resolveToolPath } from '../../../shared/tools/path-validator';
import { resolveShellCwd, rejectOutsideWorkspaceShell } from '../../../shared/tools/workspace-context';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /sudo\s/,
  /chmod\s+777/,
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;?\s*:/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sda/,
  /format\s+[cdefgh]:/i,
];

export class LocalExecutor implements CodeExecutor {
  async readFile(filePath: string, cwd: string): Promise<string> {
    const resolvedPath = resolveToolPath(filePath, cwd);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`${filePath} is a directory, not a file`);
    }
    return fs.readFileSync(resolvedPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string, cwd: string): Promise<void> {
    const resolvedPath = resolveToolPath(filePath, cwd);
    const maxSize = 500 * 1024; // 500KB limit
    if (Buffer.byteLength(content, 'utf-8') > maxSize) {
      throw new Error(`Content exceeds 500KB limit`);
    }

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = resolvedPath + '.tmp.' + crypto.randomUUID();
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, resolvedPath);
  }

  async executeShell(command: string, cwd: string): Promise<string> {
    const resolvedCwd = resolveShellCwd(cwd, undefined);

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked by safety filter`);
      }
    }

    const outsideBlock = rejectOutsideWorkspaceShell(command, cwd);
    if (outsideBlock) {
      throw new Error(outsideBlock);
    }

    const output = execSync(command, {
      cwd: resolvedCwd,
      timeout: 30000,
      maxBuffer: 100 * 1024,
      encoding: 'utf-8',
    });

    return output.slice(0, 100 * 1024);
  }
}

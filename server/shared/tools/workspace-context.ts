import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveToolPath } from './path-validator';

export type WorkspaceCheck =
  | { ok: true; root: string }
  | { ok: false; error: string };

export function optionalWorkspaceRoot(workspacePath: string): string | undefined {
  const trimmed = workspacePath.trim();
  if (!trimmed) return undefined;
  const root = path.resolve(trimmed);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return undefined;
  }
  return root;
}

export function resolveShellCwd(workspacePath: string, cwdArg?: string): string {
  if (cwdArg) {
    return resolveToolPath(cwdArg, workspacePath);
  }
  return optionalWorkspaceRoot(workspacePath) ?? os.homedir();
}

const OUTSIDE_WORKSPACE_SHELL_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\bfind\s+~/, hint: 'find starting from home (~)' },
  { pattern: /\bfind\s+\$HOME\b/, hint: '$HOME in find' },
  { pattern: /expanduser\s*\(\s*['"]~['"]\s*\)/, hint: 'expanduser("~")' },
  { pattern: /\brg\s+.*\s+~/, hint: 'ripgrep on home directory' },
  { pattern: /\bgrep\s+-r\s+.*\s+~/, hint: 'grep -r on home directory' },
];

/**
 * Reject shell commands that scan outside the configured workspace
 * (e.g. find ~/... when the agent should use search_content instead).
 */
export function rejectOutsideWorkspaceShell(
  command: string,
  workspaceRoot?: string,
): string | null {
  for (const { pattern, hint } of OUTSIDE_WORKSPACE_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked: ${hint}. Prefer read_file/write_file with the path the user gave you.`;
    }
  }

  const root = optionalWorkspaceRoot(workspaceRoot ?? '');
  if (!root) return null;

  const home = os.homedir();

  // Block bare find $HOME or find /Users/me when that is broader than workspace
  const findTarget = command.match(/\bfind\s+(?:['"])?([^\s'";|&]+)/);
  if (findTarget) {
    let target = findTarget[1].replace(/^['"]|['"]$/g, '');
    if (target === '~' || target.startsWith('~/')) {
      target = path.join(home, target.slice(2));
    }
    if (target.startsWith('/')) {
      const resolved = path.resolve(target);
      const inWorkspace =
        resolved === root || resolved.startsWith(root + path.sep);
      if (!inWorkspace) {
        return `Command blocked: find outside workspace (${resolved}). Use search_content or list_dir_tree.`;
      }
    }
  }

  return null;
}

export function workspacePromptBlock(workspaceRoot: string): string {
  return [
    '## Workspace Root (optional default)',
    `Relative paths resolve under: \`${workspaceRoot}\``,
    '- Absolute paths from the user work anywhere on disk.',
    '- Prefer `read_file` / `write_file` with the exact path the user specifies.',
  ].join('\n');
}

export function noWorkspacePromptBlock(): string {
  return [
    '## File Paths',
    'No default workspace is configured.',
    '- Use **absolute paths** from the user message with `read_file` and `write_file`.',
    '- Do not run `find ~` or scan the home directory to guess paths — use what the user provided.',
  ].join('\n');
}

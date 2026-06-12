import { execSync, type ExecSyncOptions } from 'child_process';

interface GitExecResult {
  stdout: string;
  success: boolean;
  error?: string;
}

const EXEC_OPTS = (cwd: string): ExecSyncOptions => ({
  cwd,
  encoding: 'utf-8' as const,
  timeout: 30_000,
  stdio: ['pipe', 'pipe', 'pipe'],
});

function git(args: string, cwd: string): GitExecResult {
  try {
    const stdout = execSync(`git ${args}`, EXEC_OPTS(cwd)).toString().trim();
    return { stdout, success: true };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    return {
      stdout: String(e.stdout ?? ''),
      success: false,
      error: String(e.stderr ?? err),
    };
  }
}

export interface StashResult {
  stashHash: string | null;
  commitSha: string;
  hadChanges: boolean;
}

export interface ApplyResult {
  success: boolean;
  conflictFiles?: string[];
  error?: string;
}

/**
 * Stash all working directory changes (including untracked)
 * using `git stash create` to avoid touching the reflog.
 * Then hard-reset + clean to leave a pristine tree.
 */
export function stashActiveChanges(cwd: string): StashResult {
  const commitSha = git('rev-parse HEAD', cwd);
  if (!commitSha.success) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  git('add -A', cwd);

  const statusCheck = git('status --porcelain', cwd);
  if (!statusCheck.stdout) {
    return {
      stashHash: null,
      commitSha: commitSha.stdout,
      hadChanges: false,
    };
  }

  const stash = git('stash create', cwd);
  if (!stash.success || !stash.stdout) {
    throw new Error(`git stash create failed: ${stash.error}`);
  }

  const resetResult = git('reset --hard HEAD', cwd);
  if (!resetResult.success) {
    throw new Error(`git reset --hard failed: ${resetResult.error}`);
  }

  const cleanResult = git('clean -fd', cwd);
  if (!cleanResult.success) {
    throw new Error(`git clean -fd failed: ${cleanResult.error}`);
  }

  return {
    stashHash: stash.stdout,
    commitSha: commitSha.stdout,
    hadChanges: true,
  };
}

/**
 * Apply stashed changes onto the current working directory.
 * If the current HEAD differs from target, attempt fast-forward.
 * On conflict, roll back and return structured error.
 */
export function applyStashedChanges(
  cwd: string,
  stashHash: string,
  targetCommitSha: string,
): ApplyResult {
  const currentHead = git('rev-parse HEAD', cwd);
  if (!currentHead.success) {
    return { success: false, error: 'Cannot read HEAD' };
  }

  if (currentHead.stdout !== targetCommitSha) {
    const ff = git(`merge --ff-only ${targetCommitSha}`, cwd);
    if (!ff.success) {
      return {
        success: false,
        error: `Cannot fast-forward from ${currentHead.stdout.slice(0, 8)} to ${targetCommitSha.slice(0, 8)}: ${ff.error}`,
      };
    }
  }

  const apply = git(`stash apply ${stashHash}`, cwd);
  if (!apply.success) {
    const conflicts = parseConflicts(apply.stdout + '\n' + (apply.error ?? ''));
    rollback(cwd);
    return {
      success: false,
      conflictFiles: conflicts.length > 0 ? conflicts : undefined,
      error: `Merge conflict during stash apply: ${apply.error}`,
    };
  }

  return { success: true };
}

/**
 * Hard reset + clean to guarantee a pristine working directory.
 */
export function rollback(cwd: string): void {
  git('reset --hard HEAD', cwd);
  git('clean -fd', cwd);
}

/**
 * Get the current HEAD SHA.
 */
export function getHeadSha(cwd: string): string {
  const result = git('rev-parse HEAD', cwd);
  if (!result.success) throw new Error('Not a git repository');
  return result.stdout;
}

function parseConflicts(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    // English: "CONFLICT (content): Merge conflict in file.ts"
    const matchEn = line.match(/CONFLICT.*?:\s+Merge conflict in\s+(.+)/);
    if (matchEn) { files.push(matchEn[1].trim()); continue; }
    // Fallback: detect UU-prefixed paths from `git status --porcelain` (language-agnostic)
    const matchPorcelain = line.match(/^UU\s+(.+)/);
    if (matchPorcelain) { files.push(matchPorcelain[1].trim()); continue; }
    // CJK/generic: line containing CONFLICT and a path-like token
    const matchGeneric = line.match(/CONFLICT.*?[:\uff1a]\s+.*?\s+(\S+\.\S+)/i);
    if (matchGeneric) { files.push(matchGeneric[1].trim()); }
  }
  return [...new Set(files)];
}

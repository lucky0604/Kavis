import path from 'path';
import fs from 'fs';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const BLOCKED_ABSOLUTE_PREFIXES = ['/dev/', '/proc/', '/sys/'];

/** Path patterns that agents should never read or write autonomously. */
const SENSITIVE_PATH_PATTERNS = [
  /\b\.ssh\b/,
  /\b\.aws\b/,
  /\b\.gpg\b/,
  /\bcredentials\b/,
  /\b\.config\/.*token/,
  /\b\.config\/.*key/,
  /\b\.config\/.*secret/,
];

function resolveAbsolutePath(absPath: string, workspaceRoot?: string): string {
  const resolved = path.resolve(absPath);

  if (BLOCKED_ABSOLUTE_PREFIXES.some((p) => resolved.startsWith(p))) {
    throw new PathError(`Path not allowed: ${resolved}`);
  }

  if (SENSITIVE_PATH_PATTERNS.some((p) => p.test(resolved))) {
    throw new PathError(`Path not allowed (sensitive): ${resolved}`);
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    const dir = path.dirname(resolved);
    const base = path.basename(resolved);
    try {
      realPath = path.join(fs.realpathSync(dir), base);
    } catch {
      // New file — parent may not exist yet; write_file will mkdir -p
      return resolved;
    }
  }

  // Symlink escape check: if the resolved path is within the workspace,
  // ensure post-symlink-resolution it stays there.
  if (workspaceRoot) {
    try {
      const rootReal = fs.realpathSync(path.resolve(workspaceRoot));
      if (resolved === rootReal || resolved.startsWith(rootReal + path.sep)) {
        if (!realPath.startsWith(rootReal + path.sep) && realPath !== rootReal) {
          throw new PathError('Symlink escape: path resolves outside workspace');
        }
      }
    } catch { /* workspace root may not exist */ }
  }

  return realPath;
}

/**
 * Resolve a tool path. Absolute paths are used as-is (user-specified).
 * Relative paths are resolved against workspaceRoot when configured.
 */
export function resolveToolPath(requestedPath: string, workspaceRoot?: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new PathError('Path is required');
  }

  if (path.isAbsolute(trimmed)) {
    return resolveAbsolutePath(trimmed, workspaceRoot);
  }

  const root = workspaceRoot?.trim();
  if (!root) {
    // No workspace configured — fall back to current working directory.
    // This prevents tools from failing when run from a packaged AppImage
    // where the user hasn't explicitly set a workspace path.
    return validatePath(trimmed, process.cwd());
  }

  return validatePath(trimmed, root);
}

export function validatePath(requestedPath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, requestedPath);

  // Block sensitive absolute prefixes (applied post-resolution so
  // relative paths resolved against any workspace root are covered)
  if (BLOCKED_ABSOLUTE_PREFIXES.some((p) => resolved.startsWith(p))) {
    throw new PathError(`Path not allowed: ${resolved}`);
  }
  if (SENSITIVE_PATH_PATTERNS.some((p) => p.test(resolved))) {
    throw new PathError(`Path not allowed (sensitive): ${resolved}`);
  }

  // Resolve symlinks to prevent symlink escape
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    // If path doesn't exist yet (e.g. write_file creating a new file),
    // resolve the parent directory and append the filename
    const dir = path.dirname(resolved);
    const base = path.basename(resolved);
    try {
      realPath = path.join(fs.realpathSync(dir), base);
    } catch {
      throw new PathError('Path outside workspace or parent does not exist');
    }
  }

  // Re-check sensitive patterns on the symlink-resolved real path.
  // A symlink named 'temp_link' could point to '.ssh/id_rsa' inside
  // the workspace, bypassing the pre-resolution check.
  if (BLOCKED_ABSOLUTE_PREFIXES.some((p) => realPath.startsWith(p))) {
    throw new PathError(`Path not allowed: ${resolved}`);
  }
  if (SENSITIVE_PATH_PATTERNS.some((p) => p.test(realPath))) {
    throw new PathError(`Path not allowed (sensitive): ${resolved}`);
  }

  const normalized = path.normalize(realPath);

  let rootReal: string;
  try {
    rootReal = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    throw new PathError('Workspace root does not exist');
  }

  // Must be within workspace (with trailing sep to prevent prefix matching)
  if (!normalized.startsWith(rootReal + path.sep) && normalized !== rootReal) {
    throw new PathError('Path outside workspace');
  }

  return normalized;
}

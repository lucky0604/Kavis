import path from 'path';
import fs from 'fs';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

export function validatePath(requestedPath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, requestedPath);

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
      throw new PathError('Path outside workspace');
    }
  }

  const normalized = path.normalize(realPath);
  const rootReal = fs.realpathSync(path.resolve(workspaceRoot));

  // Must be within workspace (with trailing sep to prevent prefix matching)
  if (!normalized.startsWith(rootReal + path.sep) && normalized !== rootReal) {
    throw new PathError('Path outside workspace');
  }

  return normalized;
}

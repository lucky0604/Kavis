/**
 * Binary Resolver — locates the Evolver CLI binary across multiple sources.
 *
 * Resolution order:
 *   1. Electron packaged app resources (production)
 *   2. Project-local node_modules (dev / standalone)
 *   3. Global PATH fallback
 */

import { spawnSync as spawnSyncFn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Resolve the evolver binary path.
 * Returns the shell command and extra args, or null if not found.
 */
export function resolveEvolverBinary(): { cmd: string; args: string[] } | null {
  // ---- 1. Electron packaged app ----
  if (process.resourcesPath && fs.existsSync(process.resourcesPath)) {
    const resPaths = [
      path.join(process.resourcesPath, 'node_modules', '@evomap', 'evolver'),
      path.join(process.resourcesPath, 'app', 'node_modules', '@evomap', 'evolver'),
    ];
    for (const pkgDir of resPaths) {
      const bin = tryReadBin(pkgDir);
      if (bin) return bin;
    }
  }

  // ---- 2. Project-local node_modules ----
  try {
    const pkgJsonPath = require.resolve('@evomap/evolver/package.json');
    const pkgDir = path.dirname(pkgJsonPath);
    const bin = tryReadBin(pkgDir);
    if (bin) return bin;
  } catch {
    // @evomap/evolver not found locally — this is expected if the package
    // isn't installed. Evolution falls back to heuristic-only mode.
  }

  // ---- 3. Global PATH ----
  try {
    const result = spawnSync('which', ['evolver'], { timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const globalPath = result.stdout.trim();
      if (fs.existsSync(globalPath)) {
        return { cmd: globalPath, args: [] };
      }
    }
  } catch {
    // not in PATH
  }

  return null;
}

/** Read bin entry from a package directory and return the spawn command. */
function tryReadBin(pkgDir: string): { cmd: string; args: string[] } | null {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
      bin?: string | Record<string, string>;
    };

    let binPath: string | undefined;
    if (typeof pkg.bin === 'string') {
      binPath = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      binPath = pkg.bin.evolver;
    }

    if (!binPath) return null;

    const absoluteBin = path.resolve(pkgDir, binPath);
    if (!fs.existsSync(absoluteBin)) return null;

    // If it's a JS file, spawn via node; otherwise assume executable
    if (absoluteBin.endsWith('.js')) {
      return { cmd: process.execPath, args: [absoluteBin] };
    }
    return { cmd: absoluteBin, args: [] };
  } catch {
    return null;
  }
}

/**
 * Synchronous spawn helper for internal use.
 */
function spawnSync(
  cmd: string,
  args: string[],
  options: { timeout: number }
): { status: number | null; stdout: string } {
  const result = spawnSyncFn(cmd, args, {
    timeout: options.timeout,
    encoding: 'utf-8',
  });
  return { status: result.status, stdout: result.stdout || '' };
}

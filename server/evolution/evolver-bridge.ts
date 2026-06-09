/**
 * Evolver Bridge — CLI spawn wrapper for @evomap/evolver
 *
 * Resolves the Evolver binary from multiple sources (in order):
 * 1. Local node_modules (dev / bundled Electron app)
 * 2. Electron app resources directory (production packaged)
 * 3. Global PATH (user installed via `npm i -g`)
 *
 * Process isolation via spawn (not import) is maintained to keep
 * GPL-3.0 contained within the spawned process.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface EvolverConfig {
  /** Path to project's .janus directory */
  janusDir: string;
  /** Evolver strategy */
  strategy?: 'balanced' | 'innovate' | 'harden' | 'repair-only';
  /** Timeout in ms (default 120000 = 2 min) */
  timeout?: number;
}

export interface EvolverResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Parsed GEP output if available */
  gepOutput?: GepOutput;
}

export interface GepOutput {
  genes: GeneEntry[];
  capsules: CapsuleEntry[];
  events: string[];
}

export interface GeneEntry {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  createdAt: string;
}

export interface CapsuleEntry {
  id: string;
  geneId: string;
  context: string;
  result: string;
  appliedAt: string;
}

const DEFAULT_TIMEOUT = 120_000;

/**
 * Resolve the evolver binary path.
 * Priority:
 *   1. Bundled in Electron app resources (production)
 *   2. Project-local node_modules (dev / standalone)
 *   3. Global PATH fallback
 */
function resolveEvolverBinary(): { cmd: string; args: string[] } | null {
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
 * Check if Evolver CLI is available anywhere.
 */
export function isEvolverAvailable(): boolean {
  return resolveEvolverBinary() !== null;
}

/**
 * Run Evolver evolve command.
 * Spawns a child process and collects output.
 */
export async function runEvolver(config: EvolverConfig): Promise<EvolverResult> {
  const strategy = config.strategy || 'balanced';
  const timeout = config.timeout || DEFAULT_TIMEOUT;

  const binary = resolveEvolverBinary();
  if (!binary) {
    return {
      success: false,
      stdout: '',
      stderr: 'Evolver binary not found. Install with `npm install @evomap/evolver` or ensure it is bundled.',
      exitCode: null,
    };
  }

  // Ensure .janus/.evolver directory exists
  const evolverDir = path.join(config.janusDir, '.evolver');
  if (!fs.existsSync(evolverDir)) {
    fs.mkdirSync(evolverDir, { recursive: true });
  }

  const args = [
    ...binary.args,
    'evolve',
    '--strategy', strategy,
    '--output', evolverDir,
    '--format', 'json',
  ];

  return new Promise((resolve) => {
    const proc = spawn(binary.cmd, args, {
      cwd: path.dirname(config.janusDir),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: stderr + '\n[Evolver timed out]',
        exitCode: null,
      });
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);

      const result: EvolverResult = {
        success: code === 0,
        stdout,
        stderr,
        exitCode: code,
      };

      // Try to parse GEP output
      if (code === 0 && stdout.trim()) {
        try {
          result.gepOutput = parseGepOutput(stdout, evolverDir);
        } catch {
          // Non-critical — GEP output is optional
        }
      }

      resolve(result);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: null,
      });
    });
  });
}

/**
 * Scan memory directory for evolution signals.
 * Returns a summary of patterns that Evolver might find interesting.
 */
export async function scanForSignals(
  _memoryDir: string,
  janusDir: string
): Promise<EvolverResult> {
  return runEvolver({
    janusDir,
    strategy: 'balanced',
    timeout: 60000,
  });
}

/**
 * Parse Evolver's JSON output into structured GEP data.
 */
function parseGepOutput(stdout: string, evolverDir: string): GepOutput {
  const genes: GeneEntry[] = [];
  const capsules: CapsuleEntry[] = [];
  const events: string[] = [];

  // Try parsing as JSON first
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.genes) genes.push(...parsed.genes);
    if (parsed.capsules) capsules.push(...parsed.capsules);
    if (parsed.events) events.push(...parsed.events);
  } catch {
    // If not valid JSON, try reading from Evolver output files
    const genesPath = path.join(evolverDir, 'gep', 'genes.json');
    const capsulesPath = path.join(evolverDir, 'gep', 'capsules.json');
    const eventsPath = path.join(evolverDir, 'gep', 'events.jsonl');

    if (fs.existsSync(genesPath)) {
      try {
        const g = JSON.parse(fs.readFileSync(genesPath, 'utf-8'));
        if (Array.isArray(g)) genes.push(...g);
      } catch { /* ignore */ }
    }

    if (fs.existsSync(capsulesPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(capsulesPath, 'utf-8'));
        if (Array.isArray(c)) capsules.push(...c);
      } catch { /* ignore */ }
    }

    if (fs.existsSync(eventsPath)) {
      try {
        const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
        events.push(...lines);
      } catch { /* ignore */ }
    }
  }

  return { genes, capsules, events };
}

/**
 * Synchronous spawn helper for internal use.
 */
function spawnSync(
  cmd: string,
  args: string[],
  options: { timeout: number }
): { status: number | null; stdout: string } {
  const { spawnSync: spawnSyncFn } = require('child_process');
  const result = spawnSyncFn(cmd, args, { timeout: options.timeout, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout || '' };
}

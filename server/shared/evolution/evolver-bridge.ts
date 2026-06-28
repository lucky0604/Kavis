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

import { resolveEvolverBinary } from './binary-resolver';
import { parseGepOutput } from './gep-parser';
import { DEFAULT_TIMEOUT } from './evolver-types';
import type { EvolverConfig, EvolverResult } from './evolver-types';

// ---------------------------------------------------------------------------
// Re-exports (public API surface — no breaking changes to callers)
// ---------------------------------------------------------------------------

export type { EvolverConfig, EvolverResult, GepOutput, GeneEntry, CapsuleEntry } from './evolver-types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
      stderr:
        'Evolver binary not found. Install with `npm install @evomap/evolver` or ensure it is bundled.',
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
    '--strategy',
    strategy,
    '--output',
    evolverDir,
    '--format',
    'json',
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

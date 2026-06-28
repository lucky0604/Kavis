/**
 * Evolver Types — shared type definitions for the evolution bridge.
 *
 * Re-exported publicly via evolver-bridge.ts so the external API is unchanged.
 */

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

/** Default evolve command timeout (2 minutes). */
export const DEFAULT_TIMEOUT = 120_000;

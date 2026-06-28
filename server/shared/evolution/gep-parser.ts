/**
 * GEP Parser — parses Evolver's JSON output into structured GEP data.
 *
 * Tries parsing stdout as JSON first, then falls back to reading
 * GEP output files from the evolver directory.
 */

import path from 'path';
import fs from 'fs';
import type { GepOutput, GeneEntry, CapsuleEntry } from './evolver-types';

/**
 * Parse Evolver's JSON output into structured GEP data.
 */
export function parseGepOutput(stdout: string, evolverDir: string): GepOutput {
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
        const lines = fs
          .readFileSync(eventsPath, 'utf-8')
          .split('\n')
          .filter(Boolean);
        events.push(...lines);
      } catch { /* ignore */ }
    }
  }

  return { genes, capsules, events };
}

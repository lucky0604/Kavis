/**
 * Skill Crafter — Auto-generate skill drafts from detected patterns
 *
 * Takes patterns detected by PatternDetector and uses Evolver
 * (or built-in heuristics) to create skill drafts that go through
 * the SkillReviewGate before being applied.
 */

import type { DetectedPattern } from './pattern-detector';
import type { SkillDraft } from '../../../shared/types';
import { isEvolverAvailable, runEvolver, type EvolverConfig } from './evolver-bridge';

export interface SkillCrafterConfig {
  /** Path to project's .janus directory */
  janusDir: string;
  /** Whether to use Evolver for skill generation (falls back to heuristic) */
  useEvolver?: boolean;
}

/**
 * Craft a skill draft from detected patterns.
 * Tries Evolver first, falls back to heuristic generation.
 */
export async function craftSkill(
  patterns: DetectedPattern[],
  config: SkillCrafterConfig
): Promise<SkillDraft[]> {
  if (patterns.length === 0) return [];

  // Only craft skills from high-confidence patterns
  const actionable = patterns.filter(
    (p) => p.confidence >= 0.5 && p.type === 'tool_sequence'
  );

  if (actionable.length === 0) return [];

  // Try Evolver-based generation
  if (config.useEvolver && isEvolverAvailable()) {
    try {
      return await craftWithEvolver(actionable, config);
    } catch {
      // Fall through to heuristic
    }
  }

  // Heuristic-based generation
  return craftWithHeuristics(actionable);
}

/**
 * Generate skills using Evolver CLI.
 */
async function craftWithEvolver(
  _patterns: DetectedPattern[],
  config: SkillCrafterConfig
): Promise<SkillDraft[]> {
  const evolverConfig: EvolverConfig = {
    janusDir: config.janusDir,
    strategy: 'balanced',
  };

  const result = await runEvolver(evolverConfig);

  if (!result.success || !result.gepOutput) {
    return [];
  }

  // Convert GEP genes to skill drafts
  return result.gepOutput.genes.map((gene) => ({
    id: gene.id || crypto.randomUUID(),
    name: gene.name,
    description: gene.description,
    content: gene.content,
    status: 'pending' as const,
    createdAt: gene.createdAt || new Date().toISOString(),
  }));
}

/**
 * Generate skills using built-in heuristics.
 * Creates simple skill drafts from tool sequence patterns.
 */
function craftWithHeuristics(patterns: DetectedPattern[]): SkillDraft[] {
  return patterns.map((pattern) => {
    const name = generateSkillName(pattern);
    const description = pattern.suggestedAction;
    const content = generateSkillContent(pattern);

    return {
      id: crypto.randomUUID(),
      name,
      description,
      content,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
  });
}

/**
 * Generate a skill name from a pattern description.
 */
function generateSkillName(pattern: DetectedPattern): string {
  // Extract tool names from sequence pattern
  const tools = pattern.description
    .replace('Repeated tool sequence: ', '')
    .split(' → ')
    .map((t) => t.replace(/_/g, '-'))
    .join('-');

  return `auto-${tools}-workflow`;
}

/**
 * Generate skill content (a prompt template) from a pattern.
 */
function generateSkillContent(pattern: DetectedPattern): string {
  const tools = pattern.description
    .replace('Repeated tool sequence: ', '')
    .split(' → ');

  return `# ${pattern.suggestedAction}

## Description
This skill was auto-detected from a recurring pattern:
${pattern.evidence.map((e) => `- ${e}`).join('\n')}

## Tool Sequence
${tools.map((t, i) => `${i + 1}. Use ${t}`).join('\n')}

## Instructions
When this pattern is detected, execute the tool sequence in order.
Adapt arguments based on the current context.

## Frequency
Observed ${pattern.frequency} times with ${(pattern.confidence * 100).toFixed(0)}% confidence.
`;
}

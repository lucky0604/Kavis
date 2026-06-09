/**
 * Evolution System — Unified public API
 *
 * Re-exports everything other modules need from the evolution layer.
 */

export { isEvolverAvailable, runEvolver, scanForSignals } from './evolver-bridge';
export type { EvolverConfig, EvolverResult, GepOutput, GeneEntry, CapsuleEntry } from './evolver-bridge';
export { NudgeEngine } from './nudge-engine';
export type { NudgeConfig, TaskComplexity } from './nudge-engine';
export { PatternDetector } from './pattern-detector';
export type { DetectedPattern } from './pattern-detector';
export { craftSkill } from './skill-crafter';
export type { SkillCrafterConfig } from './skill-crafter';
export {
  loadReviewQueue,
  submitForReview,
  submitManyForReview,
  getPendingReviews,
  approveSkill,
  rejectSkill,
  wasRejected,
} from './skill-review';
export type { ReviewEntry, ReviewStatus } from './skill-review';

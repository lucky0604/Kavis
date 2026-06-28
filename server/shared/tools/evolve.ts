/**
 * Evolve Tool — Agent-accessible tool for self-evolution
 *
 * Allows the agent to trigger self-evolution cycles:
 * - Review pending skill drafts
 * - Approve or reject drafts
 * - Check Evolver availability
 */

import { toolRegistry } from './registry';
import { getPendingReviews, approveSkill, rejectSkill } from '../evolution/skill-review';
import { isEvolverAvailable } from '../evolution/evolver-bridge';
import type { MemoryContext } from '../memory/memory-types';
import type { ToolContext } from '../../../shared/types';
import path from 'path';
import os from 'os';

const FALLBACK_JANUS_DIR = path.join(os.homedir(), '.janus');

toolRegistry.register({
  name: 'evolve',
  description: 'Manage self-evolution: review pending skill drafts, approve or reject them, check Evolver status.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'review', 'approve', 'reject'],
        description: 'Evolution action: status=check evolver availability, review=list pending drafts, approve=approve a draft, reject=reject a draft',
      },
      draftId: {
        type: 'string',
        description: 'Skill draft ID (required for approve/reject actions)',
      },
      note: {
        type: 'string',
        description: 'Optional note for approve/reject action',
      },
    },
    required: ['action'],
  },
  execute: async (args, context: ToolContext) => {
    const action = args.action as string;

    // Resolve janusDir from memoryContext (project-scoped) or fallback to global ~/.janus
    const memCtx = context.memoryContext as MemoryContext | undefined;
    const janusDir = memCtx
      ? path.dirname(memCtx.persistentPath)
      : FALLBACK_JANUS_DIR;

    try {
      switch (action) {
        case 'status': {
          const evolverAvailable = isEvolverAvailable();
          return {
            success: true,
            data: {
              evolverAvailable,
              mode: evolverAvailable ? 'evolver-connected' : 'heuristic-only',
            },
          };
        }
        case 'review': {
          const pending = getPendingReviews(janusDir);
          return {
            success: true,
            data: {
              pendingCount: pending.length,
              drafts: pending.map((e) => e.skill),
            },
          };
        }
        case 'approve': {
          const draftId = args.draftId as string | undefined;
          if (!draftId) {
            return { success: false, error: 'draftId is required for approve action' };
          }
          const skill = approveSkill(draftId, janusDir, args.note as string | undefined);
          if (!skill) {
            return { success: false, error: `Draft not found: ${draftId}` };
          }
          return {
            success: true,
            data: { message: `Skill "${skill.name}" approved and applied`, skill },
          };
        }
        case 'reject': {
          const draftId = args.draftId as string | undefined;
          if (!draftId) {
            return { success: false, error: 'draftId is required for reject action' };
          }
          const skill = rejectSkill(draftId, janusDir, args.note as string | undefined);
          if (!skill) {
            return { success: false, error: `Draft not found: ${draftId}` };
          }
          return {
            success: true,
            data: { message: `Skill "${skill.name}" rejected`, skill },
          };
        }
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Evolution failed' };
    }
  },
});
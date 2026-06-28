import { getNativeSessionId, getLastUsedCli } from './cli-session-tracker';
import type { CliToolId } from '../../../shared/types';

export type ResumeMode = 'fresh' | 'resume' | 'handoff';

export interface CliInvocationContext {
  cliId: CliToolId;
  prompt: string;
  model?: string;
  workspacePath: string;
  resumeMode: ResumeMode;
  nativeSessionId?: string;
  handoffPrefix?: string;
}

export function determineResumeMode(
  sessionId: string | undefined,
  cliId: CliToolId,
  previousCli?: CliToolId,
): { mode: ResumeMode; nativeSessionId?: string } {
  if (!sessionId) return { mode: 'fresh' };

  // Prefer tracker; fall back to frontend-provided previousCli
  const lastCli = getLastUsedCli(sessionId) ?? previousCli;
  if (!lastCli) return { mode: 'fresh' };

  // Same CLI as last time → try native resume
  if (lastCli === cliId) {
    const tracked = getNativeSessionId(sessionId, cliId);
    if (
      tracked
      && tracked.nativeId
      && !tracked.nativeId.startsWith('__janus_')
      && tracked.lastTurnCompleted
    ) {
      return { mode: 'resume', nativeSessionId: tracked.nativeId };
    }
    return { mode: 'fresh' };
  }

  // Different CLI → handoff needed
  return { mode: 'handoff' };
}

export function buildCliArgs(ctx: CliInvocationContext): string[] {
  const { cliId, prompt, model, workspacePath, resumeMode, nativeSessionId, handoffPrefix } = ctx;

  const effectivePrompt = handoffPrefix
    ? `${handoffPrefix}\n\n---\n\n${prompt}`
    : prompt;

  switch (cliId) {
    case 'claudecode': {
      const base = [
        '-p', effectivePrompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--add-dir', workspacePath,
        ...(model ? ['--model', model] : []),
      ];
      if (resumeMode === 'resume' && nativeSessionId) {
        base.push('--resume', nativeSessionId);
      }
      return base;
    }
    case 'codex': {
      if (resumeMode === 'resume' && nativeSessionId) {
        return [
          'resume',
          '--thread-id', nativeSessionId,
          '-C', workspacePath,
          effectivePrompt,
          '--json',
          '--skip-git-repo-check',
          '-s', 'workspace-write',
          ...(model ? ['--model', model] : []),
        ];
      }
      return [
        'exec',
        '-C', workspacePath,
        effectivePrompt,
        '--json',
        '--skip-git-repo-check',
        '-s', 'workspace-write',
        ...(model ? ['--model', model] : []),
      ];
    }
    case 'opencode': {
      const base = [
        'run', effectivePrompt,
        '--dir', workspacePath,
        '--format', 'json',
        '--pure',
        ...(model ? ['--model', model] : []),
      ];
      if (resumeMode === 'resume' && nativeSessionId) {
        base.push('--session', nativeSessionId);
      }
      return base;
    }
    default:
      return [effectivePrompt];
  }
}

import type { HookManager } from './hook-manager';

const DANGEROUS_SHELL_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+\/\s/,
  /sudo\s+rm\s+-rf/,
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;?\s*:/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sda/,
];

function isDangerousShellCommand(command: string): boolean {
  const normalized = command.trim();
  return DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Register default Code Mode hooks (security guard on pre-tool). */
export function registerDefaultHooks(hookManager: HookManager): void {
  hookManager.register('pre-tool', async (ctx) => {
    for (const tc of ctx.toolCalls ?? []) {
      if (tc.name !== 'shell_exec') continue;
      const command = String(tc.arguments.command ?? '');
      if (isDangerousShellCommand(command)) {
        console.warn(`[SecurityGuard] Blocked dangerous shell_exec: ${command}`);
        return {
          status: 'abort',
          shortCircuitResponse: { reason: 'security_blocked', message: 'Dangerous shell command blocked' },
        };
      }
    }
    return { status: 'continue' };
  });
}

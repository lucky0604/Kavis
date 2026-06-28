import { execSync } from 'child_process';
import { toolRegistry } from './registry';
import { PathError } from './path-validator';
import { rejectOutsideWorkspaceShell, resolveShellCwd } from './workspace-context';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /sudo\s/,
  /chmod\s+777/,
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;?\s*:/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sda/,
  /format\s+[cdefgh]:/i,
];

toolRegistry.register({
  name: 'shell_exec',
  description: 'Execute a shell command. 30s timeout. Safety filter active.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory — absolute or relative to workspace (optional)',
      },
    },
    required: ['command'],
  },
  execute: async (args, context) => {
    try {
      const command = args.command as string;
      const cwd = resolveShellCwd(context.workspacePath, args.cwd as string | undefined);

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          return { success: false, error: `Command blocked by safety filter` };
        }
      }

      const outsideBlock = rejectOutsideWorkspaceShell(command, context.workspacePath);
      if (outsideBlock) {
        return { success: false, error: outsideBlock };
      }

      const output = execSync(command, {
        cwd,
        timeout: 30000,
        maxBuffer: 100 * 1024,
        encoding: 'utf-8',
      });

      return { success: true, data: output.slice(0, 100 * 1024) };
    } catch (err: unknown) {
      if (err instanceof PathError) {
        return { success: false, error: err.message };
      }
      if (err instanceof Error) {
        const execErr = err as { stdout?: string; stderr?: string; status?: number; killed?: boolean };
        if (execErr.killed) {
          return { success: false, error: 'Command timed out after 30s' };
        }
        return {
          success: false,
          data: {
            stdout: (execErr.stdout || '').slice(0, 5000),
            stderr: (execErr.stderr || '').slice(0, 5000),
            exitCode: execErr.status || 1,
          },
          error: err.message,
        };
      }
      return { success: false, error: 'Command execution failed' };
    }
  },
});

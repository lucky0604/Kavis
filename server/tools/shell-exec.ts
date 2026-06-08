import { execSync } from 'child_process';
import { toolRegistry } from './registry';
import { validatePath } from './path-validator';

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
  description: 'Execute a shell command in the workspace directory. 30s timeout. Safety filter active.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (defaults to workspace root)',
      },
    },
    required: ['command'],
  },
  execute: async (args, context) => {
    try {
      const command = args.command as string;
      const cwd = args.cwd
        ? validatePath(args.cwd as string, context.workspacePath)
        : context.workspacePath;

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          return { success: false, error: `Command blocked by safety filter` };
        }
      }

      const output = execSync(command, {
        cwd,
        timeout: 30000,
        maxBuffer: 100 * 1024,
        encoding: 'utf-8',
      });

      return { success: true, data: output.slice(0, 100 * 1024) };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'PathError') {
          return { success: false, error: 'Path outside workspace' };
        }
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

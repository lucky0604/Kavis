import { execSync } from 'child_process';
import { toolRegistry } from './registry';
import { validatePath } from './path-validator';

toolRegistry.register({
  name: 'git_status',
  description: 'Show the working tree status in git porcelain format.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Repository path (defaults to workspace root)',
      },
    },
    required: [],
  },
  execute: async (args, context) => {
    try {
      const repoPath = args.path
        ? validatePath(args.path as string, context.workspacePath)
        : context.workspacePath;

      const output = execSync('git status --porcelain', {
        cwd: repoPath,
        timeout: 10000,
        encoding: 'utf-8',
      });

      if (!output.trim()) {
        return { success: true, data: 'Working tree clean' };
      }

      const entries = output
        .trim()
        .split('\n')
        .map((line) => ({
          status: line.slice(0, 2).trim(),
          path: line.slice(3).trim(),
        }));

      return { success: true, data: entries };
    } catch {
      return { success: false, error: 'Not a git repository' };
    }
  },
});

toolRegistry.register({
  name: 'git_diff',
  description: 'Show changes between working tree and index (unstaged changes).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Repository path (defaults to workspace root)',
      },
    },
    required: [],
  },
  execute: async (args, context) => {
    try {
      const repoPath = args.path
        ? validatePath(args.path as string, context.workspacePath)
        : context.workspacePath;

      const output = execSync('git diff', {
        cwd: repoPath,
        timeout: 15000,
        encoding: 'utf-8',
        maxBuffer: 100 * 1024,
      });

      if (!output.trim()) {
        return { success: true, data: 'No unstaged changes' };
      }

      return { success: true, data: output.slice(0, 100 * 1024) };
    } catch {
      return { success: false, error: 'Not a git repository' };
    }
  },
});

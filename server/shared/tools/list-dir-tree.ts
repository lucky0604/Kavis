import fs from 'fs';
import path from 'path';
import { toolRegistry } from './registry';
import { resolveToolPath } from './path-validator';

// ---- list_dir ----
toolRegistry.register({
  name: 'list_dir',
  description: 'List the contents of a directory. Returns entries sorted with directories first.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the directory to list, relative to workspace root',
      },
    },
    required: ['path'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = resolveToolPath(args.path as string, context.workspacePath);

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Directory not found: ${args.path}` };
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return { success: false, error: `${args.path} is not a directory` };
      }

      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const result = entries
        .map((d) => ({
          name: d.name,
          type: d.isDirectory() ? ('dir' as const) : ('file' as const),
          size: d.isFile() ? fs.statSync(path.join(resolvedPath, d.name)).size : 0,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return { success: true, data: { entries: result } };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to list directory' };
    }
  },
});

// ---- get_project_tree ----
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '__pycache__', '.venv']);

function buildTree(dirPath: string, prefix: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const filtered = entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
    .filter((e) => !SKIP_DIRS.has(e.name));

  const sorted = filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const isLast = i === sorted.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    lines.push(prefix + connector + entry.name + (entry.isDirectory() ? '/' : ''));

    if (entry.isDirectory() && depth < maxDepth) {
      const subLines = buildTree(
        path.join(dirPath, entry.name),
        nextPrefix,
        depth + 1,
        maxDepth
      );
      lines.push(...subLines);
    }
  }
  return lines;
}

toolRegistry.register({
  name: 'get_project_tree',
  description: 'Generate a tree representation of the project directory structure.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Root path to generate tree from, relative to workspace root',
      },
      depth: {
        type: 'number',
        description: 'Maximum depth to traverse (default: 3, max: 5)',
      },
    },
    required: ['path'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = resolveToolPath(args.path as string, context.workspacePath);
      const depth = Math.min(Math.max(Number(args.depth) || 3, 1), 5);

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Path not found: ${args.path}` };
      }

      const lines = [path.basename(resolvedPath) + '/'];
      const children = buildTree(resolvedPath, '', 0, depth - 1);
      lines.push(...children);

      return { success: true, data: lines.join('\n') };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to generate tree' };
    }
  },
});

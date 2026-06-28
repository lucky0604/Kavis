import fs from 'fs';
import { toolRegistry } from './registry';
import { resolveToolPath } from './path-validator';

toolRegistry.register({
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content as a string.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file — absolute or relative to workspace',
      },
    },
    required: ['path'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = resolveToolPath(args.path as string, context.workspacePath);

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${args.path}` };
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return { success: false, error: `${args.path} is a directory, not a file` };
      }

      let content = fs.readFileSync(resolvedPath, 'utf-8');
      const maxSize = 50 * 1024; // 50KB
      if (Buffer.byteLength(content, 'utf-8') > maxSize) {
        content = content.slice(0, maxSize);
        content += '\n\n[File truncated at 50KB]';
      }

      return { success: true, data: content };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to read file' };
    }
  },
});

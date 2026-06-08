import fs from 'fs';
import path from 'path';
import { toolRegistry } from './registry';
import { validatePath } from './path-validator';

toolRegistry.register({
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories if needed. Uses atomic writes (temp file + rename).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to write to, relative to workspace root',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = validatePath(args.path as string, context.workspacePath);
      const content = args.content as string;
      const maxSize = 500 * 1024;
      if (Buffer.byteLength(content, 'utf-8') > maxSize) {
        return { success: false, error: `Content exceeds 500KB limit` };
      }

      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = resolvedPath + '.tmp.' + crypto.randomUUID();
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, resolvedPath);

      const bytesWritten = Buffer.byteLength(content, 'utf-8');
      return { success: true, data: `File written: ${args.path} (${bytesWritten} bytes)` };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: 'Path outside workspace' };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to write file' };
    }
  },
});

import fs from 'fs';
import path from 'path';
import { toolRegistry } from './registry';
import { resolveToolPath } from './path-validator';
import { SearchReplaceEngine } from '../code-mode/shared/patch/search-replace';

toolRegistry.register({
  name: 'patch_file',
  description: 'Apply a Search-Replace patch to a local file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file — absolute or relative to workspace',
      },
      patch: {
        type: 'string',
        description: 'The Search-Replace patch block containing <<<<<<< SEARCH, =======, and >>>>>>> REPLACE',
      },
    },
    required: ['path', 'patch'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = resolveToolPath(args.path as string, context.workspacePath);
      const patch = args.patch as string;

      let fileContent = '';
      if (fs.existsSync(resolvedPath)) {
        fileContent = fs.readFileSync(resolvedPath, 'utf-8');
      }

      const engine = new SearchReplaceEngine();
      const patchResult = engine.applyPatch(fileContent, patch);

      if (!patchResult.success) {
        return { success: false, error: patchResult.error || 'Failed to apply patch' };
      }

      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmpPath = resolvedPath + '.tmp.' + crypto.randomUUID();
      fs.writeFileSync(tmpPath, patchResult.newContent, 'utf-8');
      fs.renameSync(tmpPath, resolvedPath);

      const bytesWritten = Buffer.byteLength(patchResult.newContent, 'utf-8');
      return { success: true, data: `File patched: ${args.path} (${bytesWritten} bytes)` };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to patch file' };
    }
  },
});

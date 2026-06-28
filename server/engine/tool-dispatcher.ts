import type { Message, ToolCall } from '../../shared/types';
import type { StreamEvent } from '../ai/adapter';
import type { MemoryContext } from '../memory/memory-types';
import { toolRegistry } from '../tools/registry';
import { CancellationToken } from './cancellation';
import { createApprovalId, waitForToolApproval } from './tool-approval';
import { SessionMemory } from '../memory/index';

const APPROVAL_REQUIRED_TOOLS = new Set(['write_file', 'patch_file']);

export async function* dispatchToolCalls(
  toolCalls: ToolCall[],
  config: { workspacePath: string; sessionId: string },
  messagesArr: Message[],
  sessionMemory: SessionMemory,
  memCtx: MemoryContext,
  canceller: CancellationToken,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  for (const tc of toolCalls) {
    canceller.throwIfCancelled();
    try {
      let approved = true;
      if (APPROVAL_REQUIRED_TOOLS.has(tc.name)) {
        const approvalId = createApprovalId();
        const filePath = String(tc.arguments.path ?? '');
        let contentPreview = '';
        let bytes = 0;

        if (tc.name === 'write_file') {
          const content = String(tc.arguments.content ?? '');
          contentPreview = content.slice(0, 800);
          bytes = Buffer.byteLength(content, 'utf-8');
        } else if (tc.name === 'patch_file') {
          const patch = String(tc.arguments.patch ?? '');
          try {
            const fs = await import('fs');
            const { resolveToolPath } = await import('../tools/path-validator');
            const { SearchReplaceEngine } = await import('../code-mode/shared/patch/search-replace');
            const resolvedPath = resolveToolPath(filePath, config.workspacePath);
            let fileContent = '';
            if (fs.existsSync(resolvedPath)) {
              fileContent = fs.readFileSync(resolvedPath, 'utf-8');
            }
            const engine = new SearchReplaceEngine();
            const patchResult = engine.applyPatch(fileContent, patch);
            if (patchResult.success) {
              contentPreview = patchResult.newContent.slice(0, 800);
              bytes = Buffer.byteLength(patchResult.newContent, 'utf-8');
            } else {
              contentPreview = `[Patch Application Preview Failed: ${patchResult.error}]\n\nOriginal Patch:\n${patch.slice(0, 600)}`;
              bytes = Buffer.byteLength(patch, 'utf-8');
            }
          } catch (err) {
            contentPreview = `[Failed to generate preview: ${err instanceof Error ? err.message : String(err)}]\n\nOriginal Patch:\n${patch.slice(0, 600)}`;
            bytes = Buffer.byteLength(patch, 'utf-8');
          }
        }

        yield {
          type: 'approval_required',
          data: {
            id: approvalId,
            toolCallId: tc.id,
            name: tc.name,
            path: filePath,
            contentPreview,
            bytes,
          },
        };

        approved = await waitForToolApproval(approvalId, 10 * 60 * 1000, signal);
        if (signal?.aborted) return;
        yield {
          type: 'approval_resolved',
          data: { id: approvalId, approved },
        };
      }

      if (!approved) {
        const output = `Error: User denied write permission for ${String(tc.arguments.path ?? 'file')}`;
        messagesArr.push({
          id: crypto.randomUUID(),
          role: 'tool',
          content: output,
          toolCallId: tc.id,
          timestamp: Date.now(),
        });
        yield {
          type: 'tool_result',
          data: { id: tc.id, name: tc.name, success: false, output },
        };
        sessionMemory.observe(`Tool Denied: ${tc.name} | Path: ${String(tc.arguments.path ?? '')}`);
        continue;
      }

      const result = await toolRegistry.execute(tc.name, tc.arguments, {
        workspacePath: config.workspacePath,
        sessionId: config.sessionId,
        projectPath: config.workspacePath,
        memoryContext: memCtx,
      });
      const output = result.success
        ? (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2))
        : `Error: ${result.error}`;
      messagesArr.push({
        id: crypto.randomUUID(),
        role: 'tool',
        content: output,
        toolCallId: tc.id,
        timestamp: Date.now(),
      });
      yield {
        type: 'tool_result',
        data: { id: tc.id, name: tc.name, success: result.success, output },
      };

      // ---- Memory: Observe tool usage ----
      sessionMemory.observe(
        `Tool: ${tc.name} | Success: ${result.success} | Args: ${JSON.stringify(tc.arguments).slice(0, 200)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool failed';
      messagesArr.push({
        id: crypto.randomUUID(),
        role: 'tool',
        content: `Error: ${msg}`,
        toolCallId: tc.id,
        timestamp: Date.now(),
      });
      yield {
        type: 'tool_result',
        data: { id: tc.id, name: tc.name, success: false, output: msg },
      };

      // ---- Memory: Observe tool errors ----
      sessionMemory.observe(`Tool Error: ${tc.name} | Error: ${msg}`);
    }
  }
}

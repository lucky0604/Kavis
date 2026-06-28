import type { ToolCall } from '../../../../shared/types';

export interface CustomToolCall extends ToolCall {
  name: 'read_file' | 'patch_file' | 'shell_exec';
}

// 执行器接口 (为后期 Docker 沙箱留出完美接口)
export interface CodeExecutor {
  executeShell(command: string, cwd: string): Promise<string>;
  readFile(filePath: string, cwd: string): Promise<string>;
  writeFile(filePath: string, content: string, cwd: string): Promise<void>;
}

// 差异块编辑引擎接口
export interface PatchEngine {
  applyPatch(fileContent: string, patchContent: string): { success: boolean; newContent: string; error?: string };
}

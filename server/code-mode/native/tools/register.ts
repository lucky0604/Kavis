import { registerDelegateTaskTool } from './delegate-task';

/** Register native Code Mode tools (side-effect safe — idempotent). */
export function registerNativeCodeModeTools(): void {
  registerDelegateTaskTool();
}

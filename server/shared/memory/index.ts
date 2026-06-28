/**
 * Memory System — Unified public API
 *
 * Re-exports everything other modules need from the memory layer.
 */

export { initMemoryContext, loadResidentMemory, closeDb } from './persistent-memory';
export { SessionMemory } from './session-memory';
export { recallMemories, formatRecalledMemories } from './memory-recall';
export { asyncMemoryFlush, commitFlushData, llmMemoryFlush, extractFlushData } from './memory-flush';
export { consolidateMemory, consolidateWithLLM } from './memory-consolidation';
export type { MemoryContext, RecallResult, FlushData, MemoryCategory, MemorySource } from './memory-types';

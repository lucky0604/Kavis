import { create } from 'zustand';
import type { CliToolId } from '../../shared/types';

interface CodeModeState {
  activeCli: CliToolId;
  activeModel: string;
  isRelaying: boolean;
  isExecuting: boolean;
  activeProcessId: number | null;
  setActiveCli: (cli: CliToolId) => void;
  setActiveModel: (model: string) => void;
  setRelaying: (v: boolean) => void;
  setExecuting: (v: boolean) => void;
  setActiveProcessId: (pid: number | null) => void;
}

export const useCodeModeStore = create<CodeModeState>((set) => ({
  activeCli: 'kavis-code',
  activeModel: '',
  isRelaying: false,
  isExecuting: false,
  activeProcessId: null,
  setActiveCli: (cli) => set({ activeCli: cli }),
  setActiveModel: (model) => set({ activeModel: model }),
  setRelaying: (v) => set({ isRelaying: v }),
  setExecuting: (v) => set({ isExecuting: v }),
  setActiveProcessId: (pid) => set({ activeProcessId: pid }),
}));

import { create } from 'zustand';
import type { CliToolId } from '../../shared/types';

interface CodeModeState {
  activeCli: CliToolId;
  /**
   * User's explicit per-CLI model choice. Empty/missing entry means
   * "fall back to derived default" (override from Settings for kavis-code,
   * otherwise the CLI's own default).
   *
   * The active/effective model is NEVER stored here — it is derived
   * on every render via `useEffectiveCodeModel`. This guarantees that
   * Settings changes (codeModeUseOverride / codeModeModel) propagate
   * to Code Mode immediately without a client restart.
   */
  pickedModelByCli: Partial<Record<CliToolId, string>>;
  isRelaying: boolean;
  isExecuting: boolean;
  activeProcessId: number | null;
  setActiveCli: (cli: CliToolId) => void;
  setPickedModel: (cli: CliToolId, model: string) => void;
  clearPickedModel: (cli: CliToolId) => void;
  setRelaying: (v: boolean) => void;
  setExecuting: (v: boolean) => void;
  setActiveProcessId: (pid: number | null) => void;
}

export const useCodeModeStore = create<CodeModeState>((set) => ({
  activeCli: 'kavis-code',
  pickedModelByCli: {},
  isRelaying: false,
  isExecuting: false,
  activeProcessId: null,
  setActiveCli: (cli) => set({ activeCli: cli }),
  setPickedModel: (cli, model) =>
    set((state) => ({
      pickedModelByCli: { ...state.pickedModelByCli, [cli]: model },
    })),
  clearPickedModel: (cli) =>
    set((state) => {
      const next = { ...state.pickedModelByCli };
      delete next[cli];
      return { pickedModelByCli: next };
    }),
  setRelaying: (v) => set({ isRelaying: v }),
  setExecuting: (v) => set({ isExecuting: v }),
  setActiveProcessId: (pid) => set({ activeProcessId: pid }),
}));

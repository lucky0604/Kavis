import { useEffect, useState } from 'react';
import type { CliDetectionResult, CliToolId } from '../../../../shared/types';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import { useCodeModeStore } from '../../../stores/code-mode-store';
import { useChatStore } from '../../../stores/chat-store';
import { resolveEffectiveModel, type EffectiveModelResolution } from './effective-model';

export type { EffectiveModelResolution } from './effective-model';
export { resolveEffectiveModel } from './effective-model';

export function getPreviousCliFromMessages(sessionId: string): CliToolId | undefined {
  const store = useCodeModeSessionStore.getState();
  const messages = store.sessionCache[sessionId] ?? store.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.cliId) {
      return msg.cliId;
    }
  }
  return undefined;
}

export function useIsNarrow(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return narrow;
}

export function useEffectiveCodeModel(cliResults: CliDetectionResult[]): EffectiveModelResolution {
  const activeCli = useCodeModeStore((s) => s.activeCli);
  const pickedModel = useCodeModeStore((s) => s.pickedModelByCli[s.activeCli]);
  const codeModeUseOverride = useChatStore((s) => s.codeModeUseOverride);
  const codeModeModel = useChatStore((s) => s.codeModeModel);
  const cliResult = cliResults.find((c) => c.id === activeCli);
  return resolveEffectiveModel(
    activeCli,
    cliResult,
    pickedModel,
    codeModeUseOverride,
    codeModeModel,
  );
}

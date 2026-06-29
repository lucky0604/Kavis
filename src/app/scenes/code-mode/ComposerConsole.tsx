import { useEffect, useRef, useState, useCallback } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import { useCodeModeStore } from '../../../stores/code-mode-store';
import { useChatStore } from '../../../stores/chat-store';
import { useSceneStore } from '../../../stores/scene-store';
import type { CliDetectionResult, CliToolId } from '../../../../shared/types';
import { PickerSheet } from './PickerSheet';
import { getPreviousCliFromMessages, useEffectiveCodeModel, useIsNarrow } from './composer-hooks';
import styles from './ComposerConsole.module.css';

interface Props {
  onStreamEvent?: (sessionId: string, event: { type: string; data: unknown }) => void;
  onSend?: (prompt: string) => void;
}

export function ComposerConsole({ onStreamEvent, onSend }: Props) {
  const activeCli = useCodeModeStore((s) => s.activeCli);
  const setActiveCli = useCodeModeStore((s) => s.setActiveCli);
  const setPickedModel = useCodeModeStore((s) => s.setPickedModel);
  const {
    activeSessionId,
    ensureSessionBeforeSend,
    applyStreamEvent,
    setSessionExecuting,
    persistSession,
    isSessionExecuting,
  } = useCodeModeSessionStore();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [cliResults, setCliResults] = useState<CliDetectionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sheetType, setSheetType] = useState<'cli' | 'model' | null>(null);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const isNarrow = useIsNarrow();

  const { model: activeModel } = useEffectiveCodeModel(cliResults);

  const isCurrentSessionExecuting = activeSessionId
    ? isSessionExecuting(activeSessionId)
    : false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/code-mode/detect')
      .then((r) => r.json())
      .then((data: { clis: CliDetectionResult[] }) => {
        if (cancelled) return;
        setCliResults(data.clis);
        // If the persisted/default activeCli is not actually available on this
        // machine, fall back to the first available CLI. Without this check
        // the picker shows an empty model list and the apiKey guard misfires.
        const current = useCodeModeStore.getState().activeCli;
        const currentIsAvailable = data.clis.some((c) => c.id === current && c.available);
        if (!currentIsAvailable) {
          const fallback = data.clis.find((c) => c.available);
          if (fallback) setActiveCli(fallback.id);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveCli]);

  const handleCliChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setActiveCli(e.target.value as CliToolId);
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || isCurrentSessionExecuting) return;

    const activeProject = useProjectStore.getState().getActiveProject();
    if (!activeProject) {
      const sessionId = useCodeModeSessionStore.getState().activeSessionId;
      if (sessionId) {
        applyStreamEvent(sessionId, {
          type: 'error',
          data: { message: 'Import or select a project in the sidebar first.' },
        });
      }
      return;
    }

    const ready = await ensureSessionBeforeSend();
    if (!ready) {
      const sessionId = useCodeModeSessionStore.getState().activeSessionId;
      if (sessionId) {
        applyStreamEvent(sessionId, {
          type: 'error',
          data: { message: 'Could not start a session for this project.' },
        });
      }
      return;
    }

    const sessionId = useCodeModeSessionStore.getState().activeSessionId;
    if (!sessionId) return;

    const previousCli = getPreviousCliFromMessages(sessionId);

    setInput('');
    setSessionExecuting(sessionId, true);
    onSend?.(prompt);

    const abort = new AbortController();
    abortControllersRef.current.set(sessionId, abort);

    try {
      const wsParam = `?workspace=${encodeURIComponent(activeProject.path)}`;
      const chat = useChatStore.getState();
      const useOverride = chat.codeModeUseOverride;
      const effectiveApiKey = useOverride ? (chat.codeModeApiKey.trim() || chat.apiKey) : chat.apiKey;
      const effectiveBaseUrl = useOverride ? (chat.codeModeBaseUrl.trim() || chat.baseUrl) : chat.baseUrl;
      // activeModel is already the single source of truth (resolveEffectiveModel
      // handles picked / override-for-kavis-code / cli-default / cli-first).
      // Only fall back to chat.modelName when activeModel is empty (no cliResult
      // and no override) — never re-apply codeModeModel here, which would leak
      // the kavis-code override into other CLIs (codex/claude/opencode).
      const effectiveModel = activeModel || chat.modelName;

      if (activeCli === 'kavis-code' && !effectiveApiKey) {
        const errMsg = '尚未配置 API Key，请先到设置中填写。';
        applyStreamEvent(sessionId, { type: 'error', data: { message: errMsg } });
        onStreamEvent?.(sessionId, { type: 'error', data: { message: errMsg } });
        setSessionExecuting(sessionId, false);
        useSceneStore.getState().openSettings(useOverride ? 'code' : 'work');
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (effectiveApiKey) headers['X-API-Key'] = effectiveApiKey;

      const res = await fetch(`/api/code-mode/stream${wsParam}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cliId: activeCli,
          prompt,
          model: effectiveModel,
          baseUrl: effectiveBaseUrl.trim(),
          workspacePath: activeProject.path,
          sessionId,
          previousCli,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        applyStreamEvent(sessionId, { type: 'error', data: { message: `HTTP ${res.status}` } });
        onStreamEvent?.(sessionId, { type: 'error', data: { message: `HTTP ${res.status}` } });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              applyStreamEvent(sessionId, event);
              onStreamEvent?.(sessionId, event);
              if (event.type === 'done') {
                await persistSession(sessionId);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errorEvent = { type: 'error', data: { message: String(err) } };
        applyStreamEvent(sessionId, errorEvent);
        onStreamEvent?.(sessionId, errorEvent);
      }
    } finally {
      setSessionExecuting(sessionId, false);
      abortControllersRef.current.delete(sessionId);
    }
  };

  const handleCancel = () => {
    if (!activeSessionId) return;
    abortControllersRef.current.get(activeSessionId)?.abort();
  };

  const currentCli = cliResults.find((c) => c.id === activeCli);
  const models = currentCli?.models ?? [];
  const canSend = !!activeProjectId && !isCurrentSessionExecuting;

  const handleCliSheetSelect = useCallback((id: string) => {
    setActiveCli(id as CliToolId);
    setSheetType(null);
  }, [setActiveCli]);

  const handleModelSheetSelect = useCallback((id: string) => {
    setPickedModel(activeCli, id);
    setSheetType(null);
  }, [activeCli, setPickedModel]);

  const handleModelInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPickedModel(activeCli, e.target.value);
  };

  return (
    <div className={styles.composerContainer}>
      <div className={styles.dropdownRow}>
        <div className={styles.selectWrapper}>
          <div className={styles.selectLabel}>Agent CLI</div>
          <select
            className={styles.select}
            value={activeCli}
            onChange={handleCliChange}
            disabled={loading || isCurrentSessionExecuting}
            onClick={isNarrow ? (e) => { e.preventDefault(); setSheetType('cli'); } : undefined}
          >
            {loading ? (
              <option>Detecting...</option>
            ) : (
              cliResults.filter((c) => c.available).map((cli) => (
                <option key={cli.id} value={cli.id}>
                  {cli.displayName}
                </option>
              ))
            )}
          </select>
          <span className={styles.selectArrow}>▾</span>
        </div>

        <div className={styles.selectWrapper}>
          <div className={styles.selectLabel}>Model</div>
          <input
            className={styles.select}
            list={isNarrow ? undefined : `models-${activeCli}`}
            value={activeModel}
            onChange={handleModelInputChange}
            disabled={isCurrentSessionExecuting}
            placeholder="Select or type model..."
            onClick={isNarrow ? () => setSheetType('model') : undefined}
            readOnly={isNarrow}
          />
          {!isNarrow && (
            <datalist id={`models-${activeCli}`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          className={styles.textInput}
          placeholder={
            !activeProjectId
              ? 'Import a project to start…'
              : isCurrentSessionExecuting
                ? 'Executing...'
                : 'Type a message to relay...'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!canSend}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        {isCurrentSessionExecuting && (
          <button onClick={handleCancel} className={styles.cancelButton}>
            Cancel
          </button>
        )}
      </div>

      {sheetType === 'cli' && (
        <PickerSheet
          title="Select Agent CLI"
          options={cliResults.filter((c) => c.available).map((cli) => ({
            id: cli.id,
            label: cli.displayName,
            active: cli.id === activeCli,
          }))}
          onSelect={handleCliSheetSelect}
          onClose={() => setSheetType(null)}
        />
      )}

      {sheetType === 'model' && (
        <PickerSheet
          title="Select Model"
          options={models.map((m) => ({
            id: m,
            label: m,
            active: m === activeModel,
          }))}
          onSelect={handleModelSheetSelect}
          onClose={() => setSheetType(null)}
        />
      )}
    </div>
  );
}

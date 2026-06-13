import { useEffect, useRef, useState, useCallback } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import { useCodeModeStore } from '../../../stores/app-stores';
import type { CliDetectionResult, CliToolId } from '../../../../shared/types';
import styles from './ComposerConsole.module.css';

function useIsNarrow(breakpoint = 768): boolean {
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

interface PickerSheetProps {
  title: string;
  options: Array<{ id: string; label: string; disabled?: boolean; active?: boolean }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function PickerSheet({ title, options, onSelect, onClose }: PickerSheetProps) {
  return (
    <div className={styles.sheetOverlay} onClick={onClose}>
      <div className={styles.sheetPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>{title}</span>
          <button className={styles.sheetCloseBtn} onClick={onClose}>×</button>
        </div>
        {options.map((opt) => (
          <button
            key={opt.id}
            className={
              opt.disabled
                ? styles.sheetOptionDisabled
                : opt.active
                  ? styles.sheetOptionActive
                  : styles.sheetOption
            }
            onClick={() => !opt.disabled && onSelect(opt.id)}
            disabled={opt.disabled}
          >
            <span>{opt.label}</span>
            <span className={styles.sheetOptionStatus}>
              {opt.disabled ? '✗' : opt.active ? '●' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  onStreamEvent?: (sessionId: string, event: { type: string; data: unknown }) => void;
  onSend?: (prompt: string) => void;
}

export function ComposerConsole({ onStreamEvent, onSend }: Props) {
  const { activeCli, activeModel, setActiveCli, setActiveModel } = useCodeModeStore();
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

  const isCurrentSessionExecuting = activeSessionId
    ? isSessionExecuting(activeSessionId)
    : false;

  useEffect(() => {
    setLoading(true);
    fetch('/api/code-mode/detect')
      .then((r) => r.json())
      .then((data: { clis: CliDetectionResult[] }) => {
        setCliResults(data.clis);
        const available = data.clis.find((c) => c.available);
        if (available) {
          setActiveCli(available.id);
          setActiveModel(available.defaultModel ?? available.models?.[0] ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setActiveCli, setActiveModel]);

  const handleCliChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value as CliToolId;
    setActiveCli(id);
    const cli = cliResults.find((c) => c.id === id);
    setActiveModel(cli?.defaultModel ?? cli?.models?.[0] ?? '');
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

    setInput('');
    setSessionExecuting(sessionId, true);
    onSend?.(prompt);

    const abort = new AbortController();
    abortControllersRef.current.set(sessionId, abort);

    try {
      const wsParam = `?workspace=${encodeURIComponent(activeProject.path)}`;
      const res = await fetch(`/api/code-mode/stream${wsParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliId: activeCli,
          prompt,
          model: activeModel,
          workspacePath: activeProject.path,
          sessionId,
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
    const cli = cliResults.find((c) => c.id === id);
    setActiveModel(cli?.defaultModel ?? cli?.models?.[0] ?? '');
    setSheetType(null);
  }, [cliResults, setActiveCli, setActiveModel]);

  const handleModelSheetSelect = useCallback((id: string) => {
    setActiveModel(id);
    setSheetType(null);
  }, [setActiveModel]);

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
              cliResults.map((cli) => (
                <option key={cli.id} value={cli.id} disabled={!cli.available}>
                  {cli.displayName} {cli.available ? '✓' : '✗ Not installed'}
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
            onChange={(e) => setActiveModel(e.target.value)}
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
          options={cliResults.map((cli) => ({
            id: cli.id,
            label: `${cli.displayName} ${cli.available ? '✓' : '✗'}`,
            disabled: !cli.available,
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

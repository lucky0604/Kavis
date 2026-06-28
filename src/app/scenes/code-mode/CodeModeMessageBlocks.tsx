import { useState } from 'react';
import msgStyles from '../chat/MessageList.module.css';
import type { CodeModeToolCall } from '../../../stores/code-mode-session-types';

/** Animated thinking dots + inline reasoning text from the model. */
export function ThinkingBlock({ text }: { text: string }) {
  // Collapse long thinking by default, show summary + expand
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n').filter(Boolean);
  const preview = lines.length > 2 ? `${lines[0]}\n${lines[1]}` : text;

  return (
    <div
      style={{
        margin: '8px 0',
        padding: '8px 12px',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-subtle)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, opacity: 0.5 }}>🧠</span>
        <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
          Thinking...
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          color: 'var(--color-text-muted)',
          fontFamily: 'inherit',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: expanded ? 'none' : '3.2em',
          overflow: 'hidden',
          cursor: lines.length > 2 ? 'pointer' : undefined,
        }}
        onClick={() => lines.length > 2 && setExpanded(!expanded)}
      >
        {expanded ? text : preview}
        {lines.length > 2 && (
          <span style={{ color: 'var(--color-accent-500)', marginLeft: 4 }}>
            {expanded ? ' ▲ less' : ' ▼ more'}
          </span>
        )}
      </pre>
    </div>
  );
}

/** Inline hook lifecycle event for assistant messages. */
export function HookEventBlock({
  hookType,
  status,
  round,
  detail,
}: {
  hookType: string;
  status: 'start' | 'continue' | 'rewrite' | 'abort';
  round?: number;
  detail?: string;
}) {
  const statusLabel =
    status === 'start'
      ? 'running'
      : status === 'abort'
        ? 'blocked'
        : status === 'rewrite'
          ? 'rewritten'
          : 'done';

  const icon =
    status === 'abort' ? '🛑' : status === 'rewrite' ? '✏️' : status === 'start' ? '⚡' : '✓';

  return (
    <div
      style={{
        margin: '4px 0',
        padding: '4px 10px',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--color-border-subtle)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{icon}</span>
      <span style={{ fontFamily: 'monospace' }}>{hookType}</span>
      {round !== undefined && <span>r{round}</span>}
      <span style={{ opacity: 0.7 }}>{statusLabel}</span>
      {detail && <span style={{ fontStyle: 'italic' }}>{detail}</span>}
    </div>
  );
}

/** Inline tool call card for assistant messages. */
export function ToolEventBlock({ tool }: { tool: CodeModeToolCall }) {
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  return (
    <div
      className={`${msgStyles.toolBlock} ${isRunning ? msgStyles.toolRunning : isError ? msgStyles.toolError : msgStyles.toolDone}`}
      style={{ margin: '6px 0' }}
    >
      <div className={msgStyles.toolHeader}>
        <span className={msgStyles.toolIcon}>{isRunning ? '🔧' : isError ? '❌' : '✅'}</span>
        <span className={msgStyles.toolLabel}>{tool.name}</span>
        {tool.summary && <span className={msgStyles.toolArgSummary}>{tool.summary}</span>}
        {isRunning ? (
          <span className={msgStyles.toolSpinner} />
        ) : isError ? (
          <span className={msgStyles.toolStatusError}>error</span>
        ) : (
          <span className={msgStyles.toolStatusOk}>done</span>
        )}
      </div>
    </div>
  );
}

/** Inline progress log for assistant messages. */
export function ProgressBlock({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  // Show only the last 3 entries to avoid clutter
  const visible = logs.slice(-3);

  return (
    <div style={{ margin: '4px 0', padding: '4px 0' }}>
      {visible.map((log, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            lineHeight: 1.8,
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--color-accent-500)', opacity: 0.3, flexShrink: 0 }} />
          {log}
        </div>
      ))}
    </div>
  );
}
import { useState } from 'react';
import styles from './InspectorPane.module.css';

export interface ToolCardData {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  summary: string;
  diff?: string;
}

export interface ApprovalCardData {
  id: string;
  title: string;
  description: string;
  diff?: string;
  status: 'pending' | 'approved' | 'denied' | 'locked_timeout';
  onApprove?: () => void;
  onDeny?: () => void;
  onRetry?: () => void;
}

interface Props {
  tools?: ToolCardData[];
  approvals?: ApprovalCardData[];
  onClose?: () => void;
}

function DiffView({ diff }: { diff: string }) {
  return (
    <div className={styles.diffBlock}>
      {diff.split('\n').map((line, i) => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = styles.diffAdd;
        else if (line.startsWith('-') && !line.startsWith('---')) cls = styles.diffRemove;
        else if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index '))
          cls = styles.diffMeta;
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

function ToolCard({ card }: { card: ToolCardData }) {
  const [expanded, setExpanded] = useState(false);

  const statusCls =
    card.status === 'running'
      ? styles.statusRunning
      : card.status === 'done'
        ? styles.statusDone
        : styles.statusError;

  return (
    <div className={styles.toolCard}>
      <div className={styles.toolCardHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.toolCardIcon}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.toolCardName}>{card.name}</span>
        <span className={statusCls}>{card.status}</span>
      </div>
      {expanded && (
        <div className={styles.toolCardBody}>
          <div>{card.summary}</div>
          {card.diff && <DiffView diff={card.diff} />}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ card }: { card: ApprovalCardData }) {
  const isLocked = card.status === 'locked_timeout';

  return (
    <div className={`${styles.approvalCard} ${isLocked ? styles.approvalLocked : ''}`}>
      <div className={styles.approvalHeader}>
        <span>⚡</span>
        <span>{card.title}</span>
      </div>
      <div className={styles.approvalBody}>
        <div style={{ fontSize: '12px', marginBottom: '8px' }}>{card.description}</div>
        {card.diff && <DiffView diff={card.diff} />}
      </div>
      {card.status === 'pending' && (
        <div className={styles.approvalActions}>
          <button className={styles.approveBtn} onClick={card.onApprove}>
            Approve (Y)
          </button>
          <button className={styles.denyBtn} onClick={card.onDeny}>
            Deny (N)
          </button>
        </div>
      )}
      {isLocked && (
        <div className={styles.lockOverlay}>
          <div className={styles.lockText}>Waiting Timeout — Process Paused</div>
          <button className={styles.retryBtn} onClick={card.onRetry}>
            Re-activate
          </button>
        </div>
      )}
    </div>
  );
}

export function InspectorPane({ tools = [], approvals = [], onClose }: Props) {
  const hasContent = tools.length > 0 || approvals.length > 0;

  return (
    <div className={styles.inspectorPane}>
      <div className={styles.header}>
        <span>Inspector</span>
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose} title="Close inspector">
            ×
          </button>
        )}
      </div>

      <div className={styles.cardList}>
        {!hasContent && (
          <div className={styles.emptyInspector}>No active tool calls or approvals</div>
        )}
        {approvals.map((a) => (
          <ApprovalCard key={a.id} card={a} />
        ))}
        {tools.map((t) => (
          <ToolCard key={t.id} card={t} />
        ))}
      </div>
    </div>
  );
}

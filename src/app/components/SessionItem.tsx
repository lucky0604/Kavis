import type { SessionMeta } from '../../../shared/types';
import styles from './SessionItem.module.css';

interface SessionItemProps {
  session: SessionMeta;
  isActive?: boolean;
  isRunning?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionItem({ session, isActive, isRunning, onSelect, onDelete }: SessionItemProps) {
  return (
    <div
      className={`${styles.sessionItem} ${isActive ? styles.sessionItemActive : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session.sessionId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(session.sessionId);
        }
      }}
      aria-label={`Open session: ${session.name}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span className={`${styles.dot} ${isRunning ? styles.dotRunning : ''}`} aria-hidden />
      <span className={styles.sessionName}>{session.name}</span>
      {onDelete && (
        <button
          className={styles.deleteButton}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.sessionId);
          }}
          title="Delete session"
          aria-label={`Delete session: ${session.name}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

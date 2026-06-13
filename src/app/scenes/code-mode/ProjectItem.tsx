import { useState, useEffect, useCallback } from 'react';
import type { ProjectMeta, SessionMeta } from '../../../../shared/types';
import { SessionItem } from '../../components/SessionItem';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import styles from './ProjectItem.module.css';

interface ProjectItemProps {
  project: ProjectMeta;
  isActive: boolean;
  onActivate: () => void;
  onFocus: () => void;
  onRemove: () => void;
}

const SESSION_LIMIT = 20;

function FolderIcon() {
  return (
    <svg className={styles.folderIcon} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.2 1.2A1 1 0 0 0 7.8 4.5H12.5A1.5 1.5 0 0 1 14 6v6.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V4.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shortenPath(p: string): string {
  if (p.startsWith('/Users/')) {
    const parts = p.split('/');
    if (parts.length > 3) return '~/' + parts.slice(3).join('/');
  }
  if (p.length > 36) return '…' + p.slice(-33);
  return p;
}

export function ProjectItem({ project, isActive, onActivate, onFocus, onRemove }: ProjectItemProps) {
  const [expanded, setExpanded] = useState(isActive);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const {
    activeSessionId,
    executingSessions,
    sessionListVersion,
    createSession,
    loadSession,
    deleteSession,
  } = useCodeModeSessionStore();

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/sessions?scope=code-mode&workspace=${encodeURIComponent(project.path)}`,
      );
      if (!res.ok) {
        throw new Error('Failed to load sessions');
      }
      const data = await res.json();
      setSessions((data.sessions as SessionMeta[]).slice(0, SESSION_LIMIT));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  useEffect(() => {
    if (expanded) {
      void fetchSessions();
    }
  }, [expanded, project.path, sessionListVersion, fetchSessions]);

  useEffect(() => {
    if (isActive) {
      setExpanded(true);
    }
  }, [isActive]);

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    if (newExpanded) {
      onFocus();
    }
  };

  const handleNewSession = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onActivate();
    setCreating(true);
    setError(null);
    try {
      await createSession(project.path);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenSession = async (sessionId: string) => {
    onActivate();
    setError(null);
    try {
      await loadSession(sessionId, project.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open session');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setError(null);
    try {
      await deleteSession(sessionId);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  return (
    <div className={`${styles.projectItem} ${isActive ? styles.active : ''}`}>
      <div
        className={styles.header}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        aria-expanded={expanded}
        aria-label={`Project: ${project.name}`}
      >
        <FolderIcon />
        <div className={styles.nameBlock}>
          <span className={styles.name}>{project.name}</span>
          {expanded && (
            <span className={styles.subtitle}>{shortenPath(project.path)}</span>
          )}
        </div>
        <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}>▶</span>
        <button
          className={styles.removeProjectButton}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove project"
          aria-label={`Remove project ${project.name}`}
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className={styles.sessionList}>
          {loading ? (
            <div className={styles.loading}>Loading…</div>
          ) : error ? (
            <div className={styles.error}>
              {error}
              <button onClick={() => void fetchSessions()} className={styles.retryButton}>Retry</button>
            </div>
          ) : sessions.length === 0 ? (
            <div className={styles.noSessions}>No sessions yet</div>
          ) : (
            sessions.map((session) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                isActive={session.sessionId === activeSessionId}
                isRunning={Boolean(executingSessions[session.sessionId])}
                onSelect={handleOpenSession}
                onDelete={handleDeleteSession}
              />
            ))
          )}

          <button
            className={styles.newSessionButton}
            onClick={handleNewSession}
            disabled={creating}
          >
            {creating ? 'Creating…' : '+ New session'}
          </button>
        </div>
      )}
    </div>
  );
}

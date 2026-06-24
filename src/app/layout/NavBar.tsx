import { useEffect, useState } from 'react';
import { useSceneStore, useThemeStore, useSessionStore, useAgentStore } from '../../stores/app-stores';
import { useChatStore } from '../../stores/chat-store';
import styles from './NavBar.module.css';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function NavBar() {
  const { currentScene, navigate } = useSceneStore();
  const { theme, toggle } = useThemeStore();
  const { activeMode } = useAgentStore();
  const { sessions, currentSessionId, setSessions, setCurrentSession, removeSession } = useSessionStore();
  const resetSession = useChatStore((s) => s.resetSession);
  const [loading, setLoading] = useState(false);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sessions?scope=work');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleNewChat = () => {
    resetSession();
    if (currentScene !== 'chat') {
      navigate('chat');
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    setCurrentSession(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/load`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        useChatStore.setState({
          sessionId,
          messages: data.messages || [],
          isStreaming: false,
          isConnecting: false,
          connectionError: false,
          errorMessage: null,
        });
      }
    } catch {
      // ignore
    }
    if (currentScene !== 'chat') {
      navigate('chat');
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        removeSession(sessionId);
        if (currentSessionId === sessionId) {
          setCurrentSession(null);
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <nav className={styles.navbar}>
      {/* Header spacer (brand moved to global title bar) */}
      <div className={styles.header} />

      {/* New Chat */}
      <div className={styles.newChatSection}>
        <button className={styles.newChatButton} onClick={handleNewChat}>
          <span className={styles.newChatIcon}>+</span>
          New chat
        </button>
      </div>

      {/* Session List */}
      <div className={styles.sessionList}>
        {sessions.length === 0 ? (
          <div className={styles.emptySessions}>
            {loading ? 'Loading...' : 'No sessions yet'}
          </div>
        ) : (
          sessions.map((sess) => (
            <div
              key={sess.sessionId}
              role="button"
              tabIndex={0}
              className={`${styles.sessionItem} ${sess.sessionId === currentSessionId ? styles.sessionItemActive : ''}`}
              onClick={() => handleSelectSession(sess.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectSession(sess.sessionId);
                }
              }}
            >
              <span className={styles.sessionName}>{sess.name}</span>
              <span className={styles.sessionMeta}>{formatRelative(sess.lastActiveAt)}</span>
              <button
                className={styles.deleteButton}
                onClick={(e) => handleDeleteSession(e, sess.sessionId)}
                title="Delete session"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* Bottom actions */}
      <div className={styles.navBottom}>
        <button
          className={`${styles.navButton} ${activeMode === 'code' ? styles.navButtonActive : ''}`}
          onClick={() => navigate(activeMode === 'code' ? 'chat' : 'code_mode')}
          title={activeMode === 'code' ? 'Back to Work Mode' : 'Code Mode'}
        >
          ⚡
        </button>
        <button
          className={`${styles.navButton} ${currentScene === 'terminal_spike' ? styles.navButtonActive : ''}`}
          onClick={() => navigate('terminal_spike')}
          title="Terminal Spike"
        >
          ＞_
        </button>
        <button
          className={`${styles.navButton} ${currentScene === 'settings' ? styles.navButtonActive : ''}`}
          onClick={() => navigate('settings')}
          title="Settings"
        >
          ⚙
        </button>
        <button className={styles.navButton} onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </nav>
  );
}

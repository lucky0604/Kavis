import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../../stores/chat-store';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import styles from './ChatPane.module.css';

export function ChatPane() {
  const { messages, isStreaming, isConnecting, connectionError, errorMessage, sendMessage, stopGeneration, clearError } =
    useChatStore();
  const listRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll to bottom on new messages unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, userScrolledUp]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    setUserScrolledUp(scrollHeight - scrollTop - clientHeight > 100);
  };

  return (
    <div className={styles.chatPane}>
      {/* Error banner */}
      {errorMessage && (
        <div className={styles.errorBanner}>
          <span>{errorMessage}</span>
          <button className={styles.errorDismiss} onClick={clearError} title="Dismiss">×</button>
        </div>
      )}

      {/* Connection error banner (SSE disconnect) */}
      {connectionError && (
        <div className={styles.reconnectBanner}>
          Connection interrupted. Reconnecting...
        </div>
      )}

      {/* Message list */}
      <div className={styles.messageArea} ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>◆</div>
            <h2 className={styles.emptyTitle}>Janus</h2>
            <p className={styles.emptyText}>
              Ask Janus to investigate, build, or plan
            </p>
          </div>
        ) : (
          <div className={styles.messageColumn}>
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopGeneration}
        isStreaming={isStreaming}
        isConnecting={isConnecting}
      />
    </div>
  );
}

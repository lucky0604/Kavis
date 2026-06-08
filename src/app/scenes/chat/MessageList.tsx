import { useMemo } from 'react';
import type { Message } from '@shared/types';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
}

function MessageBubble({ message, isLast }: { message: Message; isLast: boolean }) {
  const cls = () => {
    switch (message.role) {
      case 'user': return styles.userMessage;
      case 'assistant': return styles.assistantMessage;
      case 'system': return styles.systemMessage;
      case 'tool': return styles.systemMessage;
      default: return styles.assistantMessage;
    }
  };

  const label = () => {
    switch (message.role) {
      case 'user': return 'You';
      case 'assistant': return 'Janus';
      case 'system': return '';
      case 'tool': return `Tool: ${message.toolCallId || ''}`;
      default: return '';
    }
  };

  // Plain text rendering for now; Markdown rendering added via react-markdown later
  const content = message.content;

  return (
    <div className={`${styles.message} ${cls()}`}>
      {label() && <div className={styles.label}>{label()}</div>}
      <div className={styles.content}>
        {content || (isLast && message.role === 'assistant' ? (
          <span className={styles.thinking}>Thinking...</span>
        ) : null)}
      </div>
    </div>
  );
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  const renderedMessages = useMemo(() => {
    return messages.map((msg, i) => (
      <MessageBubble
        key={msg.id}
        message={msg}
        isLast={i === messages.length - 1 && msg.role === 'assistant'}
      />
    ));
  }, [messages]);

  // Show thinking skeleton when streaming but no assistant message yet
  if (isStreaming && (!messages.length || messages[messages.length - 1].role === 'user')) {
    renderedMessages.push(
      <div key="thinking-skel" className={`${styles.message} ${styles.assistantMessage}`}>
        <div className={styles.label}>Janus</div>
        <div className={styles.content}>
          <span className={styles.thinking}>Thinking...</span>
        </div>
      </div>
    );
  }

  return <div className={styles.messageList}>{renderedMessages}</div>;
}

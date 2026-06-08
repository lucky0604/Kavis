import { useRef, useState, useCallback, KeyboardEvent } from 'react';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  isConnecting: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming, isConnecting }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || isConnecting) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, isConnecting, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else {
        handleSend();
      }
    }
    if (e.key === 'Escape' && isStreaming) {
      onStop();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };

  const isEmpty = value.trim().length === 0;
  const isDisabled = isEmpty || isConnecting;

  return (
    <div className={styles.composer}>
      <div className={styles.composerInner}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Describe the task, goal, or bug"
          rows={1}
          disabled={isConnecting}
          autoFocus
        />
        {isStreaming ? (
          <button
            className={styles.stopButton}
            onClick={onStop}
            title="Stop generation (Esc)"
          >
            ■
          </button>
        ) : (
          <button
            className={`${styles.sendButton} ${isDisabled ? styles.sendButtonDisabled : ''}`}
            onClick={handleSend}
            disabled={isDisabled}
            title="Send message (Enter)"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

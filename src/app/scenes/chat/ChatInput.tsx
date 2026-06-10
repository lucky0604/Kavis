import { useRef, useState, useCallback, KeyboardEvent, useEffect } from 'react';
import { useAgentStore } from '../../../stores/app-stores';
import { useChatStore } from '../../../stores/chat-store';
import { RoleSelector } from './RoleSelector';
import type { OperatingModeId, AgentRoleId } from '../../../../shared/types';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  isConnecting: boolean;
  placeholder?: string;
}

function handleSlashCommand(input: string): { handled: boolean; message?: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case '/mode': {
      const store = useAgentStore.getState();
      if (args.length === 0) {
        const lines = store.modes.map(m => `  ${m.id === store.activeMode ? '●' : '○'} ${m.id.padEnd(8)} — ${m.name}`);
        return { handled: true, message: `Available modes:\n${lines.join('\n')}\n\nUsage: /mode <work|code>` };
      }
      const targetMode = args[0].toLowerCase() as OperatingModeId;
      if (targetMode !== 'work' && targetMode !== 'code') {
        return { handled: true, message: `Unknown mode: "${targetMode}". Use work or code.` };
      }
      store.setMode(targetMode);
      const modeName = store.modes.find(m => m.id === targetMode)?.name || targetMode;
      return { handled: true, message: `Switched to ${modeName}` };
    }
    case '/role': {
      const store = useAgentStore.getState();
      if (store.activeMode !== 'code') {
        return { handled: true, message: '/role is only available in Code Mode. Use /mode code first.' };
      }
      if (args.length === 0) {
        const lines = store.roles.map(r => `  ${r.id === store.activeRole ? '●' : '○'} ${r.id.padEnd(10)} — ${r.name}`);
        return { handled: true, message: `Available roles:\n${lines.join('\n')}\n\nUsage: /role <agentic|plan|ask|debug>` };
      }
      const targetRole = args[0].toLowerCase() as AgentRoleId;
      const valid = store.roles.find(r => r.id === targetRole);
      if (!valid) {
        return { handled: true, message: `Unknown role: "${targetRole}". Use agentic, plan, ask, or debug.` };
      }
      store.setRole(targetRole);
      return { handled: true, message: `Switched to ${valid.name}` };
    }
    case '/clear': {
      useChatStore.getState().resetSession();
      return { handled: true, message: 'Session cleared' };
    }
    default:
      return { handled: false };
  }
}

export function ChatInput({ onSend, onStop, isStreaming, isConnecting, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cmd+. — cycle through code roles (only in Code Mode)
  useEffect(() => {
    const handle = (e: globalThis.KeyboardEvent) => {
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const store = useAgentStore.getState();
        if (store.activeMode !== 'code') return;
        const roles = store.roles;
        if (roles.length === 0) return;
        const idx = roles.findIndex((r) => r.id === store.activeRole);
        const next = roles[(idx + 1) % roles.length];
        store.setRole(next.id);
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || isConnecting) return;

    if (trimmed.startsWith('/')) {
      const result = handleSlashCommand(trimmed);
      if (result.handled) {
        if (result.message) {
          useChatStore.getState().addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: result.message,
            timestamp: Date.now(),
          });
        }
        setValue('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        return;
      }
    }

    onSend(trimmed);
    setValue('');
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
        <div className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Describe the task, goal, or bug'}
            rows={1}
            disabled={isConnecting}
            autoFocus
          />
        </div>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <RoleSelector />
            <span className={styles.shortcutHint}>⌘Enter to send</span>
          </div>
          <div className={styles.toolbarRight}>
            {isStreaming ? (
              <button
                className={styles.stopButton}
                onClick={onStop}
                title="Stop generation (Esc)"
                aria-label="停止生成"
              >
                <span className={styles.stopIcon}>■</span>
              </button>
            ) : (
              <button
                className={`${styles.sendButton} ${isDisabled ? styles.sendButtonDisabled : ''}`}
                onClick={handleSend}
                disabled={isDisabled}
                title="Send message (Enter)"
                aria-label="发送消息"
                aria-disabled={isDisabled}
              >
                <span className={styles.sendIcon}>↑</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

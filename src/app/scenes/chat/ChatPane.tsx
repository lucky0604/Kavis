import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../../stores/chat-store';
import { useAgentStore } from '../../../stores/app-stores';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ModeSelector } from './ModeSelector';
import styles from './ChatPane.module.css';

interface SuggestedPrompt {
  title: string;
  text: string;
  icon: string;
}

export function ChatPane() {
  const { messages, isStreaming, isConnecting, connectionError, errorMessage, sendMessage, stopGeneration, clearError } =
    useChatStore();
  const { activeMode, activeRole, modes, roles } = useAgentStore();
  const listRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const currentMode = modes.find(m => m.id === activeMode);
  const currentRole = activeMode === 'code' ? roles.find(r => r.id === activeRole) : undefined;

  const placeholderMap: Record<string, string> = {
    work: 'Describe the task, goal, or bug',
    code_agentic: 'Describe the task, goal, or bug for the AI agent',
    code_plan: 'What do you want to plan or explore?',
    code_debug: 'Describe the error or unexpected behavior',
    code_ask: 'Ask any question about the codebase',
  };

  function getPlaceholder(): string {
    if (activeMode === 'code') {
      return placeholderMap[`code_${activeRole}`] || placeholderMap.work;
    }
    return placeholderMap.work;
  }

  function getSuggestedPrompts(): SuggestedPrompt[] {
    if (activeMode === 'work') {
      return [
        {
          title: 'Review Recent Changes',
          text: 'Review my recent git changes and check for any potential bugs or style issues.',
          icon: '🔍',
        },
        {
          title: 'Explain Core Architecture',
          text: 'Explain the core architecture of the Janus project and how the agent loop works.',
          icon: '🏗️',
        },
        {
          title: 'Security Audit',
          text: 'Perform a security audit on the server-side code to check for symlink escape or ReDoS vulnerabilities.',
          icon: '🔐',
        },
      ];
    }

    switch (activeRole) {
      case 'agentic':
        return [
          {
            title: 'Fix Type Errors',
            text: 'Analyze the project for any remaining TypeScript compilation or type errors and fix them.',
            icon: '🔴',
          },
          {
            title: 'Implement Feature',
            text: 'Help me design and implement a new feature in the Janus desktop application.',
            icon: '🟣',
          },
        ];
      case 'plan':
        return [
          {
            title: 'Electron Packaging Plan',
            text: 'Create a detailed step-by-step plan to fully package Janus as an Electron desktop app.',
            icon: '🗺️',
          },
          {
            title: 'State Management Review',
            text: 'Analyze our Zustand stores and propose optimizations for session persistence and state sharing.',
            icon: '📊',
          },
        ];
      case 'ask':
        return [
          {
            title: 'Where is Agent Loop?',
            text: 'Where is the main agent-loop engine defined, and what are its Phase 2 features?',
            icon: '❓',
          },
          {
            title: 'How does Memory work?',
            text: 'Explain how the memory recall and persistent session storage mechanisms are implemented.',
            icon: '🧠',
          },
        ];
      case 'debug':
        return [
          {
            title: 'Analyze Loop Detector',
            text: 'Analyze the loop-detector.ts logic to see how it prevents infinite agent tool-call cycles.',
            icon: '🔄',
          },
          {
            title: 'Troubleshoot Connection',
            text: 'What are the potential failure points in the server-side SSE (Server-Sent Events) streaming connection?',
            icon: '⚡',
          },
        ];
      default:
        return [];
    }
  }

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

  const emptyName = currentMode?.name || 'Janus';
  const emptyDescription = activeMode === 'code' && currentRole
    ? currentRole.description
    : (currentMode?.description || 'Ask Janus to investigate, build, or plan');

  const handlePromptClick = (promptText: string) => {
    if (isStreaming || isConnecting) return;
    sendMessage(promptText);
  };

  return (
    <div className={styles.chatPane}>
      {/* Mode selector (segmented control in beautiful header bar) */}
      <div className={styles.agentHeader}>
        <ModeSelector />
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className={styles.errorBanner}>
          <span>{errorMessage}</span>
          <button className={styles.errorDismiss} onClick={clearError} title="Dismiss">×</button>
        </div>
      )}

      {/* Connection error banner */}
      {connectionError && (
        <div className={styles.reconnectBanner}>
          Connection interrupted. Reconnecting...
        </div>
      )}

      {/* Message list */}
      <div className={styles.messageArea} ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyLogo}> Janus </div>
            <h2 className={styles.emptyTitle}>{emptyName}</h2>
            <p className={styles.emptyText}>{emptyDescription}</p>

            {/* Suggested Prompts Cards Grid */}
            <div className={styles.suggestedPrompts}>
              {getSuggestedPrompts().map((prompt, idx) => (
                <button
                  key={idx}
                  className={styles.promptCard}
                  onClick={() => handlePromptClick(prompt.text)}
                  disabled={isStreaming || isConnecting}
                >
                  <span className={styles.promptIcon}>{prompt.icon}</span>
                  <div className={styles.promptContent}>
                    <span className={styles.promptTitle}>{prompt.title}</span>
                    <span className={styles.promptText}>{prompt.text}</span>
                  </div>
                </button>
              ))}
            </div>
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
        placeholder={getPlaceholder()}
      />
    </div>
  );
}

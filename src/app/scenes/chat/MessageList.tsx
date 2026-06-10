import { useState, useMemo } from 'react';
import type { Message, ToolMeta, EventMeta, MemoryRecallMeta, SkillReviewMeta, EvolutionEventMeta } from '@shared/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
}

// ---- Helper to extract raw text from React children ----
function extractText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node.props) {
    if (node.props.children) {
      return extractText(node.props.children);
    }
    if (node.props.value) {
      return String(node.props.value);
    }
  }
  return '';
}

// ---- Beautiful CodeBlock Component with Header and Copy Button ----
function CodeBlock({ children }: { children: any }) {
  const [copied, setCopied] = useState(false);

  // Extract the code element
  const codeElement = children && children.type === 'code' ? children : null;
  const className = codeElement ? codeElement.props.className || '' : '';
  const match = /language-(\w+)/.exec(className);
  const language = match ? match[1] : 'text';

  // Extract raw text for copying
  const rawCode = codeElement ? extractText(codeElement.props.children) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code: ', err);
    }
  };

  return (
    <div className={styles.codeBlockContainer}>
      <div className={styles.codeBlockHeader}>
        <span className={styles.codeBlockLanguage}>{language}</span>
        <button
          className={styles.copyButton}
          onClick={handleCopy}
          aria-label={copied ? '代码已复制到剪贴板' : '复制代码到剪贴板'}
          aria-pressed={copied}
        >
          {copied ? (
            <>
              <span className={styles.copyIcon}>✓</span>
              <span>已复制</span>
            </>
          ) : (
            <>
              <span className={styles.copyIcon}>📋</span>
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className={styles.codeBlockPre}>
        {children}
      </pre>
    </div>
  );
}

// ---- Tool icon mapping ----
const TOOL_ICONS: Record<string, string> = {
  web_search: '🔍',
  web_fetch: '🌐',
  read_file: '📄',
  write_file: '✏️',
  list_dir: '📁',
  search_content: '🔎',
  shell_exec: '⌨️',
  git_status: '📋',
  git_diff: '📝',
};

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  web_fetch: 'Fetching page',
  read_file: 'Reading file',
  write_file: 'Writing file',
  list_dir: 'Listing directory',
  search_content: 'Searching code',
  shell_exec: 'Running command',
  git_status: 'Checking git status',
  git_diff: 'Viewing diff',
};

// ---- ToolCallBlock ----
function ToolCallBlock({ meta }: { meta: ToolMeta }) {
  const icon = TOOL_ICONS[meta.name] || '⚙️';
  const label = TOOL_LABELS[meta.name] || meta.name;
  const isRunning = meta.status === 'running';

  return (
    <div className={`${styles.toolBlock} ${isRunning ? styles.toolRunning : styles.toolDone}`}>
      <div className={styles.toolHeader}>
        <span className={styles.toolIcon}>{icon}</span>
        <span className={styles.toolLabel}>{label}</span>
        {meta.argSummary && (
          <span className={styles.toolArgSummary}>{meta.argSummary}</span>
        )}
        {isRunning ? (
          <span className={styles.toolSpinner} />
        ) : meta.status === 'error' ? (
          <span className={styles.toolStatusError}>✗</span>
        ) : (
          <span className={styles.toolStatusOk}>✓</span>
        )}
      </div>
      {/* Source links for search results */}
      {meta.sources && meta.sources.length > 0 && (
        <div className={styles.toolSources}>
          {meta.sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
              title={s.url}
            >
              {sourceIcon(s.url)}{sourceDomain(s.url)}
            </a>
          ))}
        </div>
      )}
      {/* Result summary */}
      {meta.resultSummary && meta.status === 'done' && !meta.sources?.length && (
        <div className={styles.toolResultSummary}>{meta.resultSummary}</div>
      )}
    </div>
  );
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function sourceIcon(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('github.com')) return '🐙 ';
    if (host.includes('stackoverflow.com')) return '📚 ';
    if (host.includes('wikipedia.org')) return '📖 ';
    if (host.includes('docs.')) return '📑 ';
    return '🔗 ';
  } catch {
    return '🔗 ';
  }
}

// ---- Expandable raw output ----
function ExpandableOutput({ output }: { output: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!output) return null;

  return (
    <div className={styles.expandableOutput}>
      <button className={styles.expandToggle} onClick={() => setExpanded(!expanded)}>
        {expanded ? '▼ Hide output' : '▶ Show output'}
      </button>
      {expanded && (
        <pre className={styles.rawOutput}>{output.slice(0, 2000)}{output.length > 2000 ? '\n... (truncated)' : ''}</pre>
      )}
    </div>
  );
}

// ---- Memory Recall Card ----
function MemoryRecallCard({ meta }: { meta: MemoryRecallMeta }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.eventCard}>
      <div className={styles.eventHeader}>
        <span className={styles.eventIcon}>🧠</span>
        <span className={styles.eventLabel}>Recalled {meta.count} memor{meta.count === 1 ? 'y' : 'ies'}</span>
        <button className={styles.expandToggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'}
        </button>
      </div>
      {expanded && (
        <div className={styles.eventBody}>
          {meta.memories.map((m, i) => (
            <div key={m.id || i} className={styles.memoryItem}>
              <div className={styles.memoryTag}>
                <span className={styles.memoryCategory}>{m.category}</span>
                {m.staleness && <span className={styles.memoryStale}>{m.staleness}</span>}
              </div>
              <div className={styles.memoryContent}>{m.content.slice(0, 200)}{m.content.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Skill Review Card ----
function SkillReviewCard({ meta }: { meta: SkillReviewMeta }) {
  const s = meta.skill;
  return (
    <div className={styles.eventCard}>
      <div className={styles.eventHeader}>
        <span className={styles.eventIcon}>⚡</span>
        <span className={styles.eventLabel}>Skill Review</span>
        <span className={`${styles.skillStatus} ${styles[`skillStatus_${s.status}`]}`}>{s.status}</span>
      </div>
      <div className={styles.eventBody}>
        <div className={styles.skillName}>{s.name}</div>
        <div className={styles.skillDesc}>{s.description}</div>
      </div>
    </div>
  );
}

// ---- Evolution Event Indicator ----
function EvolutionEventCard({ meta }: { meta: EvolutionEventMeta }) {
  return (
    <div className={styles.eventCard}>
      <div className={styles.eventHeader}>
        <span className={styles.eventIcon}>🧬</span>
        <span className={styles.eventLabel}>{meta.event}</span>
        {meta.detail && <span className={styles.evoDetail}>{meta.detail}</span>}
      </div>
    </div>
  );
}

// ---- Event Meta Router ----
function EventCard({ meta }: { meta: EventMeta }) {
  switch (meta.type) {
    case 'memory_recall':
      return <MemoryRecallCard meta={meta} />;
    case 'skill_review':
      return <SkillReviewCard meta={meta} />;
    case 'evolution_event':
      return <EvolutionEventCard meta={meta} />;
  }
}

// ---- Beautiful CSS-only Thinking Loader ----
function ThinkingLoader() {
  return (
    <div className={styles.thinkingContainer}>
      <div className={styles.thinkingDot} />
      <div className={styles.thinkingDot} />
      <div className={styles.thinkingDot} />
      <span className={styles.thinkingText}>Thinking...</span>
    </div>
  );
}

// ---- MessageBubble ----
function MessageBubble({ message, isStreaming: isStreamingProp, i: msgIndex, messagesCount }: {
  message: Message;
  isStreaming: boolean;
  i: number;
  messagesCount: number;
}) {
  // Tool messages with meta get rich rendering
  if (message.role === 'tool' && message.toolMeta) {
    return (
      <div className={`${styles.message} ${styles.toolMessage}`}>
        <ToolCallBlock meta={message.toolMeta} />
        {message.toolMeta.rawOutput && <ExpandableOutput output={message.toolMeta.rawOutput} />}
      </div>
    );
  }

  // System messages with eventMeta get rich event cards
  if (message.role === 'system' && message.eventMeta) {
    return (
      <div className={`${styles.message} ${styles.eventMessage}`}>
        <EventCard meta={message.eventMeta} />
      </div>
    );
  }

  // Legacy tool messages without meta (backward compat)
  if (message.role === 'tool' && !message.toolMeta) {
    return null; // Skip bare tool messages with no metadata
  }

  // System messages without eventMeta — skip (internal prompts not shown)
  if (message.role === 'system' && !message.eventMeta) {
    return null;
  }

  const cls = () => {
    switch (message.role) {
      case 'user': return styles.userMessage;
      case 'assistant': return styles.assistantMessage;
      default: return styles.assistantMessage;
    }
  };

  const renderHeader = () => {
    if (message.role === 'user') {
      return (
        <div className={styles.messageHeader}>
          <div className={styles.avatarUser}>U</div>
          <span className={styles.senderName}>You</span>
        </div>
      );
    }
    if (message.role === 'assistant') {
      return (
        <div className={styles.messageHeader}>
          <div className={styles.avatarAssistant}>J</div>
          <span className={`${styles.senderName} ${styles.senderNameAssistant}`}>Janus</span>
          <span className={styles.aiBadge}>Agent</span>
        </div>
      );
    }
    return null;
  };

  const isAssistant = message.role === 'assistant';

  // Show "Thinking..." only for the LAST assistant message that is still
  // empty AND streaming is active. This handles the initial "waiting for
  // first token" state as well as new rounds that haven't produced text yet.
  const showThinking = isStreamingProp &&
    isAssistant &&
    !message.content &&
    msgIndex === messagesCount - 1;

  return (
    <div className={`${styles.message} ${cls()}`}>
      {renderHeader()}
      <div className={styles.content}>
        {message.content ? (
          isAssistant ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                pre: ({ children, ...props }: any) => {
                  const isCodeBlock = children && (
                    (children.type === 'code') || 
                    (Array.isArray(children) && children.some((c: any) => c && c.type === 'code'))
                  );
                  if (isCodeBlock) {
                    return <CodeBlock>{children}</CodeBlock>;
                  }
                  return <pre {...props}>{children}</pre>;
                }
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            message.content
          )
        ) : (showThinking ? (
          <ThinkingLoader />
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
        i={i}
        isStreaming={isStreaming}
        messagesCount={messages.length}
      />
    ));
  }, [messages, isStreaming]);

  // Show a single "Thinking..." indicator when streaming and the last message
  // is a tool result (agent is processing next round but hasn't produced text yet).
  // This is the only case where we insert a non-message skeleton element.
  const showThinkingSkeleton = isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'tool';

  return (
    <div className={styles.messageList}>
      {renderedMessages}
      {showThinkingSkeleton && (
        <div className={`${styles.message} ${styles.assistantMessage}`}>
          <div className={styles.messageHeader}>
            <div className={styles.avatarAssistant}>J</div>
            <span className={`${styles.senderName} ${styles.senderNameAssistant}`}>Janus</span>
            <span className={styles.aiBadge}>Agent</span>
          </div>
          <div className={styles.content}>
            <ThinkingLoader />
          </div>
        </div>
      )}
    </div>
  );
}

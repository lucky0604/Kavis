import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeModeLayout } from './CodeModeLayout';
import { ComposerConsole } from './ComposerConsole';
import { InspectorPane, type ToolCardData } from './InspectorPane';
import { PtyDrawer } from './PtyDrawer';
import { useCodeModeStore } from '../../../stores/app-stores';
import msgStyles from '../chat/MessageList.module.css';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function CodeModeScene() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tools, setTools] = useState<ToolCardData[]>([]);
  const { isExecuting } = useCodeModeStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleUserSend = useCallback((prompt: string) => {
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: prompt };
    const aiMsg: ChatMsg = { id: `a-${Date.now()}`, role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setTools([]);
  }, []);

  const handleStreamEvent = useCallback((event: { type: string; data: unknown }) => {
    if (event.type === 'text_delta') {
      const text = (event.data as { text?: string })?.text ?? '';
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, content: last.content + text }];
      });
    } else if (event.type === 'error') {
      const msg = (event.data as { message?: string })?.message ?? 'Unknown error';
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, content: last.content + `\n\n> **Error:** ${msg}` }];
      });
    } else if (event.type === 'tool_call') {
      const tc = event.data as { id?: string; name?: string };
      setTools((prev) => [...prev, {
        id: tc.id ?? `tool-${Date.now()}`,
        name: tc.name ?? 'unknown',
        status: 'running',
        summary: '',
      }]);
    } else if (event.type === 'tool_result') {
      const tr = event.data as { id?: string };
      if (tr.id) {
        setTools((prev) => prev.map((t) =>
          t.id === tr.id ? { ...t, status: 'done' as const } : t
        ));
      }
    }
  }, []);

  const emptyState = messages.length === 0;

  return (
    <CodeModeLayout
      chat={
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
            <div style={{ maxWidth: '720px', margin: '0 auto' }}>
              {emptyState ? (
                <div style={{
                  padding: '48px 0',
                  textAlign: 'center',
                  color: 'var(--color-text-tertiary)',
                }}>
                  Select an agent CLI and start a relay session
                </div>
              ) : (
                <div className={msgStyles.messageList}>
                  {messages.map((msg, i) => (
                    <div key={msg.id} className={`${msgStyles.message} ${msg.role === 'user' ? msgStyles.userMessage : msgStyles.assistantMessage}`}>
                      {msg.role === 'user' ? (
                        <div className={msgStyles.messageHeader}>
                          <div className={msgStyles.avatarUser}>U</div>
                          <span className={msgStyles.senderName}>You</span>
                        </div>
                      ) : (
                        <div className={msgStyles.messageHeader}>
                          <div className={msgStyles.avatarAssistant}>J</div>
                          <span className={`${msgStyles.senderName} ${msgStyles.senderNameAssistant}`}>Janus</span>
                          <span className={msgStyles.aiBadge}>Relay</span>
                        </div>
                      )}
                      <div className={msgStyles.content}>
                        {msg.role === 'assistant' ? (
                          msg.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                              {msg.content}
                            </ReactMarkdown>
                          ) : (
                            isExecuting && i === messages.length - 1 ? (
                              <div className={msgStyles.thinkingContainer}>
                                <div className={msgStyles.thinkingDot} />
                                <div className={msgStyles.thinkingDot} />
                                <div className={msgStyles.thinkingDot} />
                                <span className={msgStyles.thinkingText}>Thinking...</span>
                              </div>
                            ) : null
                          )
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <PtyDrawer />
          <ComposerConsole onStreamEvent={handleStreamEvent} onSend={handleUserSend} />
        </div>
      }
      inspector={<InspectorPane tools={tools} />}
    />
  );
}

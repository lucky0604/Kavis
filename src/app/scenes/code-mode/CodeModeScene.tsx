import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeModeLayout } from './CodeModeLayout';
import { ComposerConsole } from './ComposerConsole';
import { InspectorPane, type ToolCardData } from './InspectorPane';
import { PtyDrawer } from './PtyDrawer';
import { OnboardingDashboard } from './OnboardingDashboard';
import { ProjectSidebar } from './ProjectSidebar';
import { CodeModeHeader } from './CodeModeHeader';
import { ThinkingBlock, ToolEventBlock, ProgressBlock } from './CodeModeMessageBlocks';
import { applyRelayToolEvent } from './relay-tool-events';
import { useProjectStore } from '../../../stores/project-store';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import emptyStyles from './CodeModeEmpty.module.css';
import msgStyles from '../chat/MessageList.module.css';

export function CodeModeScene() {
  const { projects, activeProjectId } = useProjectStore();
  const {
    activeSessionId,
    sessionCache,
    appendExchange,
    switchToProject,
    isSessionExecuting,
  } = useCodeModeSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedProjectIdRef = useRef<string | null>(null);
  const toolsCacheRef = useRef(new Map<string, ToolCardData[]>());
  const [tools, setTools] = useStateTools(activeSessionId, toolsCacheRef);

  // Derive messages from the session cache keyed by activeSessionId.
  // This is the single source of truth — immune to async race conditions
  // where the store's top-level `messages` field could temporarily lag
  // behind an activeSessionId change.
  const messages = activeSessionId
    ? (sessionCache[activeSessionId] ?? [])
    : [];

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const isThinking = activeSessionId ? isSessionExecuting(activeSessionId) : false;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!activeProject) return;
    if (initializedProjectIdRef.current === activeProject.id) return;
    initializedProjectIdRef.current = activeProject.id;
    void switchToProject(activeProject.path);
  }, [activeProject?.id, activeProject?.path, switchToProject]);

  const handleUserSend = useCallback((prompt: string) => {
    if (!activeSessionId) return;
    appendExchange(prompt);
    toolsCacheRef.current.set(activeSessionId, []);
    setTools([]);
  }, [appendExchange, activeSessionId]);

  const handleStreamEvent = useCallback((sessionId: string, event: { type: string; data: unknown }) => {
    const prev = toolsCacheRef.current.get(sessionId) ?? [];
    const next = applyRelayToolEvent(prev, event);
    toolsCacheRef.current.set(sessionId, next);
    if (sessionId === useCodeModeSessionStore.getState().activeSessionId) {
      setTools(next);
    }
  }, []);

  const showProjectOnboarding = projects.length === 0;
  const showProjectReady = !showProjectOnboarding && !!activeProject;

  const chatBody = showProjectOnboarding ? (
    <OnboardingDashboard />
  ) : !showProjectReady ? (
    <div className={emptyStyles.emptyState}>
      <h2 className={emptyStyles.title}>Select a project</h2>
      <p className={emptyStyles.text}>
        Choose a project from the sidebar to start relaying to your local CLI.
      </p>
    </div>
  ) : (
    <>
      <div key={activeSessionId ?? '__none__'} ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          {messages.length === 0 ? (
            <div className={emptyStyles.emptyState} style={{ minHeight: '240px' }}>
              <h2 className={emptyStyles.title}>{activeProject.name}</h2>
              <p className={emptyStyles.text}>
                Ask anything about this codebase. Messages relay to your selected CLI
                in <code>{shortenPath(activeProject.path)}</code>.
              </p>
            </div>
          ) : (
            <div className={msgStyles.messageList}>
              {messages.map((msg, i) => (
                <div
                  key={msg.id}
                  className={`${msgStyles.message} ${msg.role === 'user' ? msgStyles.userMessage : msgStyles.assistantMessage}`}
                >
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
                      <>
                        {/* Inline thinking block */}
                        {msg.thinking && <ThinkingBlock text={msg.thinking} />}

                        {/* Inline progress logs */}
                        {msg.progress && msg.progress.length > 0 && <ProgressBlock logs={msg.progress} />}

                        {/* Inline tool call cards */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div style={{ margin: '4px 0' }}>
                            {msg.toolCalls.map((tc) => (
                              <ToolEventBlock key={tc.id} tool={tc} />
                            ))}
                          </div>
                        )}

                        {/* Main text content */}
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                            {msg.content}
                          </ReactMarkdown>
                        ) : (
                          isThinking && i === messages.length - 1 && !msg.thinking && !msg.toolCalls ? (
                            <div className={msgStyles.thinkingContainer}>
                              <div className={msgStyles.thinkingDot} />
                              <div className={msgStyles.thinkingDot} />
                              <div className={msgStyles.thinkingDot} />
                              <span className={msgStyles.thinkingText}>Thinking...</span>
                            </div>
                          ) : null
                        )}
                      </>
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
    </>
  );

  return (
    <CodeModeLayout
      sidebar={<ProjectSidebar />}
      chat={
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <CodeModeHeader />
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {chatBody}
          </div>
          <ComposerConsole onStreamEvent={handleStreamEvent} onSend={handleUserSend} />
        </div>
      }
      inspector={<InspectorPane tools={tools} />}
    />
  );
}

function shortenPath(p: string): string {
  if (p.startsWith('/Users/')) {
    const parts = p.split('/');
    if (parts.length > 3) return '~/' + parts.slice(3).join('/');
  }
  if (p.length > 48) return '…' + p.slice(-45);
  return p;
}

/** Restore inspector tools when switching sessions. */
function useStateTools(
  activeSessionId: string | null,
  cacheRef: MutableRefObject<Map<string, ToolCardData[]>>,
): [ToolCardData[], Dispatch<SetStateAction<ToolCardData[]>>] {
  const [tools, setTools] = useState<ToolCardData[]>([]);

  useEffect(() => {
    if (!activeSessionId) {
      setTools([]);
      return;
    }
    setTools(cacheRef.current.get(activeSessionId) ?? []);
  }, [activeSessionId, cacheRef]);

  return [tools, setTools];
}

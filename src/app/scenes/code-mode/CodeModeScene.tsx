import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeModeLayout } from './CodeModeLayout';
import { ComposerConsole } from './ComposerConsole';
import { InspectorPane, type ToolCardData, type ApprovalCardData } from './InspectorPane';
import { PtyDrawer } from './PtyDrawer';
import { OnboardingDashboard } from './OnboardingDashboard';
import { ProjectSidebar } from './ProjectSidebar';
import { CodeModeHeader } from './CodeModeHeader';
import { ThinkingBlock, ToolEventBlock, ProgressBlock, HookEventBlock } from './CodeModeMessageBlocks';
import { applyRelayToolEvent } from './relay-tool-events';
import { applyApprovalStreamEvent, attachApprovalHandlers } from './relay-approval-events';
import { useProjectStore } from '../../../stores/project-store';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import { useCodeModeStore } from '../../../stores/code-mode-store';
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
  const approvalsCacheRef = useRef(new Map<string, ApprovalCardData[]>());
  const [tools, setTools] = useStateTools(activeSessionId, toolsCacheRef);
  const [approvals, setApprovals] = useStateApprovals(activeSessionId, approvalsCacheRef);

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

  const { activeCli } = useCodeModeStore();

  const handleUserSend = useCallback((prompt: string) => {
    if (!activeSessionId) return;
    appendExchange(prompt, activeCli || undefined);
    toolsCacheRef.current.set(activeSessionId, []);
    approvalsCacheRef.current.set(activeSessionId, []);
    setTools([]);
    setApprovals([]);
  }, [appendExchange, activeSessionId, activeCli]);

  const handleStreamEvent = useCallback((sessionId: string, event: { type: string; data: unknown }) => {
    const prevTools = toolsCacheRef.current.get(sessionId) ?? [];
    const nextTools = applyRelayToolEvent(prevTools, event);
    toolsCacheRef.current.set(sessionId, nextTools);

    const prevApprovals = approvalsCacheRef.current.get(sessionId) ?? [];
    let nextApprovals = applyApprovalStreamEvent(prevApprovals, event);
    if (event.type === 'approval_required') {
      nextApprovals = nextApprovals.map((a) =>
        attachApprovalHandlers(a, (id, status) => {
          const updated = (approvalsCacheRef.current.get(sessionId) ?? []).map((c) =>
            c.id === id ? { ...c, status } : c,
          );
          approvalsCacheRef.current.set(sessionId, updated);
          if (sessionId === useCodeModeSessionStore.getState().activeSessionId) {
            setApprovals(updated);
          }
        }),
      );
    }
    approvalsCacheRef.current.set(sessionId, nextApprovals);

    if (sessionId === useCodeModeSessionStore.getState().activeSessionId) {
      setTools(nextTools);
      setApprovals(nextApprovals);
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
              {messages.map((msg, i) => {
                // Detect CLI switch boundary: if this is an assistant message
                // with a different cliId than the previous assistant message
                const prevAssistant = (() => {
                  for (let j = i - 1; j >= 0; j--) {
                    if (messages[j].role === 'assistant') return messages[j];
                  }
                  return undefined;
                })();
                const showHandoffDivider = msg.role === 'assistant'
                  && msg.cliId
                  && prevAssistant?.cliId
                  && msg.cliId !== prevAssistant.cliId;

                const cliBadge = msg.role === 'assistant' && msg.cliId
                  ? msg.cliId.charAt(0).toUpperCase() + msg.cliId.slice(1)
                  : 'Relay';

                return (
                <div key={msg.id}>
                  {showHandoffDivider && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      margin: '16px 0', opacity: 0.6, fontSize: '12px',
                    }}>
                      <div style={{ flex: 1, height: '1px', background: 'var(--border-secondary, #333)' }} />
                      <span>switched to {cliBadge}</span>
                      <div style={{ flex: 1, height: '1px', background: 'var(--border-secondary, #333)' }} />
                    </div>
                  )}
                  <div
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
                      <span className={msgStyles.aiBadge}>{cliBadge}</span>
                    </div>
                  )}
                  <div className={msgStyles.content}>
                    {msg.role === 'assistant' ? (
                      <>
                        {/* Inline thinking block */}
                        {msg.thinking && <ThinkingBlock text={msg.thinking} />}

                        {/* Inline progress logs */}
                        {msg.progress && msg.progress.length > 0 && <ProgressBlock logs={msg.progress} />}

                        {/* Inline hook lifecycle events */}
                        {msg.hookEvents && msg.hookEvents.length > 0 && (
                          <div style={{ margin: '4px 0' }}>
                            {msg.hookEvents.map((he) => (
                              <HookEventBlock
                                key={he.id}
                                hookType={he.hookType}
                                status={he.status}
                                round={he.round}
                                detail={he.detail}
                              />
                            ))}
                          </div>
                        )}

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
                              <span className={msgStyles.thinkingText}>
                                {msg.cliId === 'codex' ? 'Processing (batch mode)...' : 'Thinking...'}
                              </span>
                            </div>
                          ) : null
                        )}
                      </>
                    ) : (
                      msg.content
                    )}
                  </div>
                  </div>
                </div>
                );
              })}
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
      inspector={<InspectorPane tools={tools} approvals={approvals} />}
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

function useStateApprovals(
  activeSessionId: string | null,
  cacheRef: MutableRefObject<Map<string, ApprovalCardData[]>>,
): [ApprovalCardData[], Dispatch<SetStateAction<ApprovalCardData[]>>] {
  const [approvals, setApprovals] = useState<ApprovalCardData[]>([]);

  useEffect(() => {
    if (!activeSessionId) {
      setApprovals([]);
      return;
    }
    setApprovals(cacheRef.current.get(activeSessionId) ?? []);
  }, [activeSessionId, cacheRef]);

  return [approvals, setApprovals];
}

import { useState } from 'react';
import type { MemoryRecallMeta, SkillReviewMeta, EvolutionEventMeta, ToolApprovalMeta, EventMeta } from '@shared/types';
import { useChatStore } from '../../../stores/chat-store';
import { UnifiedDiffViewFromPreview } from '../../../components/UnifiedDiffView';
import styles from './MessageList.module.css';

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

// ---- Tool Write Approval Card ----
function ToolApprovalCard({ meta }: { meta: ToolApprovalMeta }) {
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const isPending = meta.status === 'pending';
  const statusLabel =
    meta.status === 'approved' ? '已批准' :
    meta.status === 'denied' ? '已拒绝' :
    meta.status === 'timeout' ? '已超时' :
    '等待确认';

  return (
    <div className={`${styles.approvalCard} ${isPending ? styles.approvalPending : ''}`}>
      <div className={styles.approvalHeader}>
        <span>✏️</span>
        <span>写入文件请求</span>
        <span className={styles.approvalStatus}>{statusLabel}</span>
      </div>
      <div className={styles.approvalBody}>
        <div className={styles.approvalPath}>{meta.path}</div>
        <div className={styles.approvalMeta}>{meta.bytes.toLocaleString()} bytes</div>
        {meta.contentPreview && (
          <UnifiedDiffViewFromPreview
            unifiedDiff={meta.unifiedDiff}
            contentPreview={meta.contentPreview}
            path={meta.path}
          />
        )}
      </div>
      {isPending && (
        <div className={styles.approvalActions}>
          <button
            className={styles.approveBtn}
            onClick={() => respondToApproval(meta.approvalId, true)}
          >
            允许写入
          </button>
          <button
            className={styles.denyBtn}
            onClick={() => respondToApproval(meta.approvalId, false)}
          >
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Event Meta Router ----
export function EventCard({ meta }: { meta: EventMeta }) {
  switch (meta.type) {
    case 'memory_recall':
      return <MemoryRecallCard meta={meta} />;
    case 'skill_review':
      return <SkillReviewCard meta={meta} />;
    case 'evolution_event':
      return <EvolutionEventCard meta={meta} />;
    case 'tool_approval':
      return <ToolApprovalCard meta={meta} />;
  }
}

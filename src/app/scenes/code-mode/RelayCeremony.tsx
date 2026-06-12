import type { CliToolId } from '../../../../shared/types';
import styles from './RelayCeremony.module.css';

type CeremonyStep = 'stashing' | 'translating' | 'booting';

const STEPS: { id: CeremonyStep; label: string; icon: string }[] = [
  { id: 'stashing', label: 'Stashing', icon: '📦' },
  { id: 'translating', label: 'Translating', icon: '🔄' },
  { id: 'booting', label: 'Booting', icon: '🚀' },
];

interface Props {
  previousCli: CliToolId;
  nextCli: CliToolId;
  currentStep: CeremonyStep;
  todoMarkdown: string;
  onTodoChange: (md: string) => void;
  onPassBaton: () => void;
  onCancel: () => void;
  loading: boolean;
}

function cliName(id: CliToolId): string {
  return id === 'claudecode' ? 'Claude' : 'OpenCode';
}

export function RelayCeremony({
  previousCli,
  nextCli,
  currentStep,
  todoMarkdown,
  onTodoChange,
  onPassBaton,
  onCancel,
  loading,
}: Props) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.ceremony}>
        <div className={styles.title}>
          Baton Pass: {cliName(previousCli)} → {cliName(nextCli)}
        </div>

        {/* Stepper */}
        <div className={styles.stepper}>
          {STEPS.map((step, i) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div
                className={`${styles.step} ${
                  i < currentIdx ? styles.stepDone : i === currentIdx ? styles.stepActive : ''
                }`}
              >
                <div className={styles.stepCircle}>
                  {i < currentIdx ? '✓' : step.icon}
                </div>
                <div className={styles.stepLabel}>{step.label}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div className={i < currentIdx ? styles.connectorDone : styles.connector} />
              )}
            </div>
          ))}
        </div>

        {/* TODO editor */}
        <div className={styles.todoEditor}>
          <div className={styles.todoEditorLabel}>Handoff Tasks</div>
          <textarea
            className={styles.todoTextarea}
            value={todoMarkdown}
            onChange={(e) => onTodoChange(e.target.value)}
            placeholder="- [ ] Continue working on..."
          />
        </div>

        {/* CTA */}
        <button
          className={styles.ctaButton}
          onClick={onPassBaton}
          disabled={loading || currentStep === 'stashing'}
        >
          {loading ? 'Processing...' : `Pass Baton to ${cliName(nextCli)}`}
        </button>
      </div>
    </div>
  );
}

/**
 * Inline chat divider showing the handoff event.
 */
export function HandoffDivider({
  from,
  to,
  stashSha,
}: {
  from: CliToolId;
  to: CliToolId;
  stashSha?: string;
}) {
  return (
    <div className={styles.handoffDivider}>
      <div className={styles.handoffDividerLine} />
      <span className={styles.handoffDividerDiamond}>◆</span>
      <span>
        Baton Passed: {cliName(from)} → {cliName(to)}
        {stashSha && ` · Git Stash: ${stashSha.slice(0, 8)}`}
      </span>
      <span className={styles.handoffDividerDiamond}>◆</span>
      <div className={styles.handoffDividerLine} />
    </div>
  );
}

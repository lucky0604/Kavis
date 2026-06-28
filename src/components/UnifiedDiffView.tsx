import styles from './UnifiedDiffView.module.css';

export interface UnifiedDiffViewProps {
  diff: string;
  maxHeight?: number | string;
  className?: string;
}

type DiffLineKind = 'add' | 'remove' | 'meta' | 'context' | 'plain';

function classifyLine(line: string): DiffLineKind {
  if (line.startsWith('@@') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'meta';
  }
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove';
  if (line.startsWith(' ')) return 'context';
  return 'plain';
}

const kindClass: Record<DiffLineKind, string | undefined> = {
  add: styles.lineAdd,
  remove: styles.lineRemove,
  meta: styles.lineMeta,
  context: styles.lineContext,
  plain: styles.linePlain,
};

/** Git-style unified diff renderer with line numbers. */
export function UnifiedDiffView({ diff, maxHeight = 320, className }: UnifiedDiffViewProps) {
  const lines = diff.split('\n');
  let oldNum = 0;
  let newNum = 0;

  const rows = lines.map((line, i) => {
    const kind = classifyLine(line);
    let oldLabel = '';
    let newLabel = '';

    if (kind === 'meta') {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
    } else if (kind === 'add') {
      newLabel = String(newNum++);
    } else if (kind === 'remove') {
      oldLabel = String(oldNum++);
    } else if (kind === 'context') {
      oldLabel = String(oldNum++);
      newLabel = String(newNum++);
    }

    return (
      <div key={i} className={`${styles.row} ${kindClass[kind] ?? ''}`}>
        <span className={styles.gutter}>{oldLabel}</span>
        <span className={styles.gutter}>{newLabel}</span>
        <span className={styles.code}>{line || ' '}</span>
      </div>
    );
  });

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`} style={{ maxHeight }}>
      <div className={styles.scroll}>{rows}</div>
    </div>
  );
}

/** Prefer unified diff; fall back to plain preview wrapped as all-additions. */
export function UnifiedDiffViewFromPreview(opts: {
  unifiedDiff?: string;
  contentPreview?: string;
  path?: string;
}): JSX.Element | null {
  if (opts.unifiedDiff?.trim()) {
    return <UnifiedDiffView diff={opts.unifiedDiff} />;
  }
  if (!opts.contentPreview?.trim()) return null;
  const pseudo = `--- a/${opts.path ?? 'file'}\n+++ b/${opts.path ?? 'file'}\n${opts.contentPreview
    .split('\n')
    .map((l) => `+${l}`)
    .join('\n')}`;
  return <UnifiedDiffView diff={pseudo} />;
}

/**
 * Build a Git-style unified diff string from two text blobs.
 * Used for approval previews (write_file / patch_file).
 */

const DEFAULT_CONTEXT = 3;

export interface DiffOp {
  type: 'same' | 'add' | 'remove';
  line: string;
}

/** LCS-based line diff. */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'add', line: newLines[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: 'remove', line: oldLines[i++] });
  while (j < n) ops.push({ type: 'add', line: newLines[j++] });
  return ops;
}

export function buildUnifiedDiff(
  oldText: string,
  newText: string,
  filePath: string,
  contextLines = DEFAULT_CONTEXT,
): string {
  const safePath = filePath.replace(/^\/+/, '') || 'file';
  const header = `--- a/${safePath}\n+++ b/${safePath}`;

  if (oldText === newText) {
    return `${header}\n(no changes)`;
  }

  const ops = diffLines(oldText, newText);
  const changeIndices = ops
    .map((op, idx) => (op.type !== 'same' ? idx : -1))
    .filter((idx) => idx >= 0);

  if (changeIndices.length === 0) {
    return `${header}\n(no changes)`;
  }

  const included = new Set<number>();
  for (const ci of changeIndices) {
    const start = Math.max(0, ci - contextLines);
    const end = Math.min(ops.length - 1, ci + contextLines);
    for (let k = start; k <= end; k++) included.add(k);
  }

  const sorted = [...included].sort((a, b) => a - b);
  const hunks: string[] = [];
  let chunk: number[] = [];

  const emitChunk = () => {
    if (chunk.length === 0) return;
    const first = chunk[0];

    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < first; k++) {
      if (ops[k].type !== 'add') oldStart++;
      if (ops[k].type !== 'remove') newStart++;
    }

    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];
    for (const k of chunk) {
      const op = ops[k];
      if (op.type === 'same') {
        lines.push(` ${op.line}`);
        oldCount++;
        newCount++;
      } else if (op.type === 'remove') {
        lines.push(`-${op.line}`);
        oldCount++;
      } else {
        lines.push(`+${op.line}`);
        newCount++;
      }
    }

    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${lines.join('\n')}`);
    chunk = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i];
    if (chunk.length === 0 || idx === chunk[chunk.length - 1] + 1) {
      chunk.push(idx);
    } else {
      emitChunk();
      chunk.push(idx);
    }
  }
  emitChunk();

  return `${header}\n${hunks.join('\n')}`;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

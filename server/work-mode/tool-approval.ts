const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingApproval>();

export function createApprovalId(): string {
  return crypto.randomUUID();
}

/**
 * Wait until the user approves/denies via POST /chat/approval, or timeout.
 */
export function waitForToolApproval(
  approvalId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const finish = (approved: boolean) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(approvalId);
      resolve(approved);
    };

    const onAbort = () => finish(false);
    signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => finish(false), timeoutMs);
    pending.set(approvalId, { resolve: finish, timeout });
  });
}

/**
 * Resolve a pending approval. Returns false if id is unknown or already resolved.
 */
export function resolveToolApproval(approvalId: string, approved: boolean): boolean {
  const entry = pending.get(approvalId);
  if (!entry) return false;
  entry.resolve(approved);
  return true;
}

export function pendingApprovalCount(): number {
  return pending.size;
}

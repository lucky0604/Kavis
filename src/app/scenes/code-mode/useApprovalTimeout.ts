import { useEffect, useRef, useState } from 'react';

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'locked_timeout';

/**
 * Manages the 10-minute approval timeout for interactive cards.
 * Returns current status and remaining time.
 */
export function useApprovalTimeout(initialStatus: ApprovalStatus = 'pending') {
  const [status, setStatus] = useState<ApprovalStatus>(initialStatus);
  const [remainingMs, setRemainingMs] = useState(TIMEOUT_MS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (status !== 'pending') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    startRef.current = Date.now();
    setRemainingMs(TIMEOUT_MS);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const remaining = TIMEOUT_MS - elapsed;

      if (remaining <= 0) {
        setStatus('locked_timeout');
        setRemainingMs(0);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setRemainingMs(remaining);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const approve = () => setStatus('approved');
  const deny = () => setStatus('denied');
  const reactivate = () => {
    setStatus('pending');
    startRef.current = Date.now();
    setRemainingMs(TIMEOUT_MS);
  };

  const remainingFormatted = formatRemaining(remainingMs);

  return { status, remainingMs, remainingFormatted, approve, deny, reactivate };
}

function formatRemaining(ms: number): string {
  const totalSecs = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

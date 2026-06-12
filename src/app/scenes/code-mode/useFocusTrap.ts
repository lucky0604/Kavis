import { useEffect, useRef, useCallback } from 'react';

/**
 * WCAG AA focus trap hook for approval cards.
 * Traps tab navigation within the container and binds Y/N/Escape keys.
 */
export function useFocusTrap(
  active: boolean,
  handlers: {
    onApprove?: () => void;
    onDeny?: () => void;
    onEscape?: () => void;
  },
) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;

      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handlers.onApprove?.();
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handlers.onDeny?.();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        handlers.onEscape?.();
        return;
      }

      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;

        const focusable = container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [active, handlers],
  );

  useEffect(() => {
    if (!active) return;

    document.addEventListener('keydown', handleKeyDown);

    const container = containerRef.current;
    if (container) {
      const firstButton = container.querySelector<HTMLElement>('button:not([disabled])');
      firstButton?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, handleKeyDown]);

  return containerRef;
}

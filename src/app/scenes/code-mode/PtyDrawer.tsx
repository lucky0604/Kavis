import { useCallback, useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '../../../stores/app-stores';
import styles from './PtyDrawer.module.css';

interface JanusNativeBridge {
  ptyCreate: (opts: { id: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ success: boolean; pid?: number; error?: string }>;
  ptyWrite: (args: { id: string; data: string }) => Promise<unknown>;
  ptyResize: (args: { id: string; cols: number; rows: number }) => Promise<unknown>;
  ptyKill: (args: { id: string }) => Promise<unknown>;
  onPtyData: (id: string, cb: (data: string) => void) => (() => void);
  onPtyExit: (id: string, cb: (exitCode: { exitCode: number; signal?: number }) => void) => (() => void);
}

function getBridge(): JanusNativeBridge | null {
  return (window as unknown as { janusNative?: JanusNativeBridge }).janusNative ?? null;
}

interface Props {
  parentHeight?: number;
}

export function PtyDrawer({ parentHeight = 600 }: Props) {
  const { ptyHeight } = useLayoutStore();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const drawerPx = open ? (parentHeight * ptyHeight) / 100 : 0;

  const initPty = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;

    try {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      const term = new Terminal({
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        theme: { background: '#111111', foreground: '#e0e0e0', cursor: '#2dd4bf' },
        cursorBlink: true,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);

      if (termRef.current) {
        term.open(termRef.current);
        fit.fit();
      }

      const id = `pty-drawer-${Date.now()}`;
      const result = await bridge.ptyCreate({ id, cols: term.cols, rows: term.rows });

      if (!result.success) {
        term.writeln(`\r\n[PTY Error: ${result.error ?? 'unknown'}]`);
        return;
      }

      setSessionId(id);

      const unsubData = bridge.onPtyData(id, (data: string) => {
        term.write(data);
      });

      const unsubExit = bridge.onPtyExit(id, () => {
        term.writeln('\r\n[Process exited]');
        setSessionId(null);
      });

      term.onData((data: string) => {
        bridge.ptyWrite({ id, data });
      });

      const resizeObserver = new ResizeObserver(() => {
        fit.fit();
        bridge.ptyResize({ id, cols: term.cols, rows: term.rows });
      });

      if (termRef.current) {
        resizeObserver.observe(termRef.current);
      }

      cleanupRef.current = () => {
        unsubData();
        unsubExit();
        resizeObserver.disconnect();
        bridge.ptyKill({ id });
        term.dispose();
        setSessionId(null);
      };
    } catch {
      // xterm or pty not available in non-Electron env
    }
  }, []);

  const toggleDrawer = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        setTimeout(() => initPty(), 50);
      } else if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return !prev;
    });
  }, [initPty]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <div className={styles.drawerContainer}>
      <button className={styles.toggleButton} onClick={toggleDrawer}>
        {open ? '▼ Close Terminal' : '▲ Open Terminal'}
      </button>

      <div
        className={open ? styles.drawer : styles.drawerCollapsed}
        style={{ height: open ? `${drawerPx}px` : 0 }}
      >
        <div className={styles.drawerHandle} onClick={toggleDrawer}>
          <span className={styles.drawerHandleLabel}>
            Escape Pod {sessionId ? '(PID active)' : ''}
          </span>
          <div className={styles.drawerHandleActions}>
            <button className={styles.drawerBtn} onClick={toggleDrawer} title="Close">
              ×
            </button>
          </div>
        </div>
        <div ref={termRef} className={styles.terminalArea} />
      </div>
    </div>
  );
}

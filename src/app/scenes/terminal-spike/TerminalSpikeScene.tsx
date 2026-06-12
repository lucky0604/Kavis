import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import styles from './TerminalSpikeScene.module.css';

export function TerminalSpikeScene() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>('');

  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'loaded' | 'missing'>('checking');
  const [ptyStatus, setPtyStatus] = useState<'idle' | 'spawning' | 'active' | 'failed' | 'exited'>('idle');
  const [ptyPid, setPtyPid] = useState<number | null>(null);
  const [ptyShell, setPtyShell] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isResizing, setIsResizing] = useState(false);

  // 1. Verify JanusNative Bridge
  useEffect(() => {
    if (window.janusNative && typeof window.janusNative.ptyCreate === 'function') {
      setBridgeStatus('loaded');
    } else {
      setBridgeStatus('missing');
    }
  }, []);

  // 2. Initialize PTY & Terminal
  useEffect(() => {
    if (bridgeStatus !== 'loaded' || !terminalRef.current) return;

    const id = `spike-${Math.random().toString(36).substring(2, 8)}`;
    sessionIdRef.current = id;
    setPtyStatus('spawning');

    // Create xterm instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: '#0c0c0d',
        foreground: '#e4e4e7',
        cursor: '#2dd4bf', // Teal Accent
        black: '#18181b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f4f4f5',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Open terminal inside Ref
    term.open(terminalRef.current);
    fitAddon.fit();

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;

    // Call native API to spawn PTY
    window.janusNative.ptyCreate({
      id,
      cols: term.cols,
      rows: term.rows,
    }).then((res: any) => {
      if (res.success) {
        setPtyPid(res.pid || null);
        setPtyShell(res.shell || '');
        setPtyStatus('active');

        // Subscribe to PTY data
        unsubscribeData = window.janusNative.onPtyData(id, (data) => {
          term.write(data);
        });

        // Subscribe to PTY exit
        unsubscribeExit = window.janusNative.onPtyExit(id, (exitRes) => {
          term.write(`\r\n\r\n[Janus PTY] Shell exited with code ${exitRes.exitCode}\r\n`);
          setPtyStatus('exited');
          setPtyPid(null);
        });

        // Write user input to PTY
        term.onData((data) => {
          window.janusNative.ptyWrite({ id, data });
        });

        term.focus();
      } else {
        setPtyStatus('failed');
        setErrorMessage(res.error || 'Unknown spawn failure.');
      }
    }).catch((err: any) => {
      setPtyStatus('failed');
      setErrorMessage(err.message || 'API call failed.');
    });

    // Handle window resizing
    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current || sessionIdRef.current === '') return;
      try {
        setIsResizing(true);
        fitAddonRef.current.fit();
        const cols = xtermRef.current.cols;
        const rows = xtermRef.current.rows;
        
        window.janusNative.ptyResize({
          id: sessionIdRef.current,
          cols,
          rows
        });
      } catch {
        // ignore resize issues during tear down
      } finally {
        setTimeout(() => setIsResizing(false), 200);
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup session and PTY
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (unsubscribeData) unsubscribeData();
      if (unsubscribeExit) unsubscribeExit();

      if (sessionIdRef.current) {
        window.janusNative.ptyKill({ id: sessionIdRef.current });
      }

      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [bridgeStatus]);

  return (
    <div className={styles.scene}>
      {/* Header Panel */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>底通道终端沙盒 Spike</h2>
          <p className={styles.subtitle}>
            验证 node-pty 原生模块主进程隔离、xterm.js 渲染与双向 IPC 低通道通信。
          </p>
        </div>

        {/* Badges */}
        <div className={styles.badgeGroup}>
          <div className={`${styles.badge} ${styles[`bridge_${bridgeStatus}`]}`}>
            API Bridge: {bridgeStatus === 'loaded' ? '✓ READY' : bridgeStatus === 'checking' ? 'Checking...' : '✗ MISSING'}
          </div>
          <div className={`${styles.badge} ${styles[`pty_${ptyStatus}`]}`}>
            PTY Status: {ptyStatus.toUpperCase()}
          </div>
          {ptyPid && (
            <div className={styles.badgeActive}>
              PID: <span className={styles.pidValue}>{ptyPid}</span>
            </div>
          )}
          {ptyShell && (
            <div className={styles.badgeShell}>
              Shell: <span className={styles.shellValue}>{ptyShell}</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Area */}
      <div className={styles.terminalContainer}>
        {bridgeStatus === 'missing' && (
          <div className={styles.errorScreen}>
            <h3>Bridge Initialization Failed</h3>
            <p>
              无法在 <code>window.janusNative</code> 中找到 PTY 核心 API。请确保应用正在 Electron 中运行，而非标准浏览器中。
            </p>
          </div>
        )}

        {bridgeStatus === 'loaded' && ptyStatus === 'failed' && (
          <div className={styles.errorScreen}>
            <h3>Spawn PTY Shell Failed</h3>
            <p className={styles.errorText}>{errorMessage}</p>
            <div className={styles.diagnosticsBox}>
              <h4>🔍 排阻诊断参考:</h4>
              <ul>
                <li>操作系统原生模块编译是否成功？可以运行 <code>npm run typecheck</code></li>
                <li>是否在 Cursor 隔离沙箱中？macOS 终端可能阻止了 Cursor 派生 PTY 权限。请尝试编译或在真实终端中用 Electron 进程直接启动它。</li>
              </ul>
            </div>
          </div>
        )}

        {bridgeStatus === 'loaded' && ptyStatus !== 'failed' && (
          <div className={styles.terminalWrapper}>
            {ptyStatus === 'spawning' && (
              <div className={styles.loadingOverlay}>Spawning secure PTY process...</div>
            )}
            <div ref={terminalRef} className={styles.xtermContainer} />
            {isResizing && <div className={styles.resizeIndicator}>Resizing grid...</div>}
          </div>
        )}
      </div>

      {/* Control Actions / Footnote */}
      <div className={styles.footer}>
        <div className={styles.note}>
          ◆ <b>数据安全保护</b>: 此处的 Shell 是一个真实子进程，但由 Electron 主进程完全监控和独立生命周期托管，应用退出时会自动物理销毁进程树，防范孤儿进程泄露。
        </div>
      </div>
    </div>
  );
}

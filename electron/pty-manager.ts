import { IpcMain, BrowserWindow } from 'electron';
import type { IPty, IPtyForkOptions } from 'node-pty';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import nodePath from 'node:path';

const esmRequire = createRequire(import.meta.url);

/**
 * node-pty's prebuilt `spawn-helper` binary may lose its executable permission
 * after npm/pnpm extraction. Fix it at load time so pty.fork() doesn't fail
 * with "posix_spawnp failed".
 */
function ensureSpawnHelperExecutable(): void {
  try {
    const ptyDir = nodePath.dirname(esmRequire.resolve('node-pty/package.json'));
    const platform = process.platform === 'darwin'
      ? `darwin-${process.arch}`
      : `${process.platform}-${process.arch}`;
    const helperPath = nodePath.join(ptyDir, 'prebuilds', platform, 'spawn-helper');

    if (fs.existsSync(helperPath)) {
      const stat = fs.statSync(helperPath);
      if (!(stat.mode & 0o111)) {
        fs.chmodSync(helperPath, 0o755);
        console.log('[Janus PTY] Fixed spawn-helper permissions:', helperPath);
      }
    }
  } catch {
    console.warn('[Janus PTY] Could not check spawn-helper permissions; pty.spawn may fail if node-pty needs a native rebuild.');
  }
}

ensureSpawnHelperExecutable();

type PtyModule = { spawn: (file: string, args: string[], options: IPtyForkOptions) => IPty };

let ptyModule: PtyModule | null = null;
try {
  ptyModule = esmRequire('node-pty') as PtyModule;
  console.log('[Janus PTY] node-pty loaded successfully');
} catch (err: unknown) {
  console.error('[Janus PTY] Failed to load node-pty. Terminal escape pod will be unavailable.', err);
}

interface PtySession {
  id: string;
  process: IPty;
}

const activeSessions = new Map<string, PtySession>();

export function setupPtyHandlers(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null) {
  if (!ptyModule) {
    // Register mock handlers if node-pty is unavailable
    ipcMain.handle('pty:create', async () => {
      return { success: false, error: 'node-pty native module is not compiled or available.' };
    });
    return;
  }

  /**
   * Spawn a new PTY shell process
   */
  ipcMain.handle('pty:create', async (_event, options: { id: string; cwd?: string; cols?: number; rows?: number }) => {
    const { id, cwd, cols = 80, rows = 24 } = options;

    try {
      if (activeSessions.has(id)) {
        return { success: false, error: `PTY session with ID ${id} already exists.` };
      }

      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh');
      const spawnEnv: Record<string, string | undefined> = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      };

      const ptyProcess = ptyModule.spawn(shell, [], {
        name: 'xterm-color',
        cols,
        rows,
        cwd: cwd || process.cwd(),
        env: spawnEnv,
      });

      console.log(`[Janus PTY] Spawned shell: ${shell} (PID: ${ptyProcess.pid}) for Session: ${id}`);

      const session: PtySession = {
        id,
        process: ptyProcess,
      };

      activeSessions.set(id, session);

      // Throttling: buffer data and emit in batch of max 30fps (approx. 33ms)
      let buffer = '';
      let timer: NodeJS.Timeout | null = null;

      ptyProcess.onData((data: string) => {
        buffer += data;
        if (!timer) {
          timer = setTimeout(() => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send(`pty:data:${id}`, buffer);
            }
            buffer = '';
            timer = null;
          }, 33); // ~30 fps throttling limit to prevent renderer lockup
        }
      });

      ptyProcess.onExit((exitCode: { exitCode: number; signal?: number }) => {
        console.log(`[Janus PTY] Shell exited with code ${exitCode.exitCode} for Session: ${id}`);
        activeSessions.delete(id);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(`pty:exit:${id}`, exitCode);
        }
      });

      return { success: true, pid: ptyProcess.pid, shell };
    } catch (err: unknown) {
      console.error('[Janus PTY] Error creating PTY process:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Write data to PTY stdin
   */
  ipcMain.handle('pty:write', async (_event, args: { id: string; data: string }) => {
    const { id, data } = args;
    const session = activeSessions.get(id);
    if (!session) {
      return { success: false, error: 'PTY session not found' };
    }

    try {
      session.process.write(data);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Resize PTY cols/rows
   */
  ipcMain.handle('pty:resize', async (_event, args: { id: string; cols: number; rows: number }) => {
    const { id, cols, rows } = args;
    const session = activeSessions.get(id);
    if (!session) {
      return { success: false, error: 'PTY session not found' };
    }

    try {
      session.process.resize(cols, rows);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Kill a PTY process and cleanup
   */
  ipcMain.handle('pty:kill', async (_event, args: { id: string }) => {
    const { id } = args;
    const session = activeSessions.get(id);
    if (!session) {
      return { success: false, error: 'PTY session not found' };
    }

    try {
      killProcessGroup(session.process);
      activeSessions.delete(id);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Kill process group safely to prevent orphaned children
 */
function killProcessGroup(proc: IPty) {
  try {
    const pid = proc.pid;
    console.log(`[Janus PTY] Cleaning up process group for PID: ${pid}`);
    if (process.platform !== 'win32') {
      // Negated PID kills the entire process group
      process.kill(-pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Process already dead — expected
        }
      }, 2000);
    } else {
      proc.kill();
    }
  } catch {
    // Process might already be dead
    try {
      proc.kill();
    } catch {
      // Already dead — nothing to do
    }
  }
}

/**
 * Teardown all sessions on application exit
 */
export function teardownAllPtySessions() {
  console.log(`[Janus PTY] Tearing down ${activeSessions.size} active PTY sessions...`);
  for (const [, session] of activeSessions.entries()) {
    killProcessGroup(session.process);
  }
  activeSessions.clear();
}

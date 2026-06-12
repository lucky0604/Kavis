/**
 * Janus Electron Main Process
 *
 * Starts a local HTTP server (with API routes + static files)
 * and opens a BrowserWindow pointing to it.
 * No remote deployment needed — everything runs locally.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPtyHandlers, teardownAllPtySessions } from './pty-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let serverHandle: { close: () => Promise<void> } | null = null;
let viteDevProc: ReturnType<typeof spawn> | null = null;

/** Poll until a URL responds with HTTP 200 */
function waitForServer(url: string, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const parsed = new URL(url);
    const check = () => {
      const req = http.get(
        { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout: 2000 },
        (res) => {
          if (res.statusCode && res.statusCode < 400) {
            resolve();
          } else {
            retryOrReject();
          }
        },
      );
      req.on('error', retryOrReject);
      req.on('timeout', () => {
        req.destroy();
        retryOrReject();
      });

      function retryOrReject() {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server at ${url} did not start within ${timeout}ms`));
        } else {
          setTimeout(check, 500);
        }
      }
    };
    check();
  });
}

async function startServer(): Promise<number | undefined> {
  const isDev = !app.isPackaged;

  if (isDev) {
    // Dev mode: spawn Vite dev server and wait for it
    const devUrl = 'http://localhost:5173';

    try {
      // Check if Vite is already running (e.g. user started it manually)
      await waitForServer(devUrl, 1000);
      console.log('[Janus] Vite dev server already running');
      return undefined; // Vite handles both frontend and API
    } catch {
      // Not running — spawn it
      console.log('[Janus] Starting Vite dev server...');
      viteDevProc = spawn('npx', ['vite'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        shell: true,
      });

      viteDevProc.on('error', (err) => {
        console.error('[Janus] Failed to start Vite:', err);
      });

      viteDevProc.on('exit', (code) => {
        if (code && code !== 0) {
          console.warn('[Janus] Vite exited with code', code);
        }
      });

      await waitForServer(devUrl, 30000);
      console.log('[Janus] Vite dev server ready');
      return undefined;
    }
  }

  // Production: start embedded server
  const distDir = path.resolve(__dirname, '..', 'dist');

  try {
    const { createJanusServer } = await import('../server/prod.js');
    const janusServer = await createJanusServer(distDir);
    serverHandle = janusServer;
    return janusServer.port;
  } catch (err) {
    console.error('[Janus] Failed to start embedded server:', err);
    return undefined;
  }
}

function createWindow(port?: number) {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Janus',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload's ipcRenderer/contextBridge. Risk: if renderer XSS occurs, attacker can invoke IPC calls (select-folder etc). Remove once preload migrates to sandbox-compatible API.
    },
  });

  // Load URL
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (port) {
    mainWindow.loadURL(`http://localhost:${port}`);
  } else {
    mainWindow.loadFile(path.resolve(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- IPC Handlers (must be registered before app.whenReady) ----

setupPtyHandlers(ipcMain, () => mainWindow);

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Workspace Folder',
  }) as unknown as Electron.OpenDialogReturnValue;
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion();
});

// Menu action channel — currently no menu sends these, but the preload
// bridge exposes the listener for future use.
// ipcMain.send('menu-action', action) will trigger onMenuAction in renderer.

// ---- App lifecycle ----

app.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  teardownAllPtySessions();
  if (serverHandle) {
    await serverHandle.close();
  }
  if (viteDevProc) {
    viteDevProc.kill();
  }
});

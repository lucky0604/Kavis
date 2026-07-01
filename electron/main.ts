/**
 * Kavis Electron Main Process
 *
 * Starts a local HTTP server (with API routes + static files)
 * and opens a BrowserWindow pointing to it.
 * No remote deployment needed — everything runs locally.
 */

import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';

// Disable GPU acceleration to avoid vaapi/Vulkan errors on Linux.
// The app is a developer tool and does not need hardware GPU rendering.
app.disableHardwareAcceleration();
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
    // Dev mode: start HTTP server in Electron main process (same Node.js ABI)
    const promptsDir = path.join(__dirname, '..', 'server', 'shared', 'agents', 'prompts');

    try {
      // Use fixed port for Vite proxy compatibility
      const DEV_SERVER_PORT = 8787;
      const { createKavisServer } = await import('../server/prod.js');
      const kavisServer = await createKavisServer(undefined, DEV_SERVER_PORT, promptsDir);
      serverHandle = kavisServer;
      console.log(`[Kavis] Embedded server started on port ${DEV_SERVER_PORT}`);

      // Spawn Vite for frontend hot reload only (Vite no longer handles API routes)
      const viteUrl = 'http://localhost:5173';
      try {
        await waitForServer(viteUrl, 1000);
        console.log('[Kavis] Vite dev server already running');
      } catch {
        console.log('[Kavis] Starting Vite dev server...');
        viteDevProc = spawn('npx', ['vite'], {
          cwd: path.resolve(__dirname, '..'),
          stdio: 'inherit',
          shell: true,
        });
        viteDevProc.on('error', (err: Error) => {
          console.error('[Kavis] Failed to start Vite:', err);
        });
        viteDevProc.on('exit', (code: number | null) => {
          if (code && code !== 0) {
            console.warn('[Kavis] Vite exited with code', code);
          }
        });
        await waitForServer(viteUrl, 30000);
        console.log('[Kavis] Vite dev server ready');
      }

      return DEV_SERVER_PORT;
    } catch (err) {
      const msg = err instanceof Error ? (err.stack || err.message) : String(err);
      console.error('[Kavis] Failed to start embedded server in dev:', msg);
      return undefined;
    }
  }

  // Production: start embedded server
  const distDir = path.resolve(__dirname, '..', 'dist');
  const promptsDir = path.join(app.getAppPath(), 'server', 'shared', 'agents', 'prompts');

  try {
    const { createKavisServer } = await import('../dist/server/prod.js');
    const kavisServer = await createKavisServer(distDir, undefined, promptsDir);
    serverHandle = kavisServer;
    return kavisServer.port;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    console.error('[Kavis] Failed to start embedded server:', msg);
    dialog.showErrorBox('Kavis Startup Error', `Failed to start embedded server:\n\n${msg}`);
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
    title: 'Kavis',
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

ipcMain.on('get-server-port', (event) => {
  event.returnValue = serverHandle?.port || null;
});

// Menu action channel — currently no menu sends these, but the preload
// bridge exposes the listener for future use.
// ipcMain.send('menu-action', action) will trigger onMenuAction in renderer.

// ---- Settings persistence (IPC → file-based at userData/settings.json) ----
// localStorage in the renderer is origin-scoped, which breaks when the embedded
// server binds to a random port on each launch (server.listen(0)). We use the
// Electron main process userData directory for cross-launch persistence.

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Keys whose VALUES are sensitive and must be encrypted at rest via
 * Electron's safeStorage (Keychain on macOS, libsecret on Linux, DPAPI on
 * Windows). Encrypted values are stored as `enc:v1:<base64-ciphertext>` so
 * we can detect already-encrypted entries on subsequent reads.
 */
const ENCRYPTED_KEYS = new Set<string>(['kavis_api_key', 'kavis_code_api_key']);
const ENC_PREFIX = 'enc:v1:';

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptValue(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(ENC_PREFIX)) return plain; // already encrypted
  if (!isEncryptionAvailable()) return plain;     // fallback: store plaintext
  try {
    const buf = safeStorage.encryptString(plain);
    return ENC_PREFIX + buf.toString('base64');
  } catch (err) {
    console.warn('[Kavis] safeStorage encrypt failed, storing plaintext:', err);
    return plain;
  }
}

function decryptValue(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  if (!isEncryptionAvailable()) return ''; // cannot decrypt — return empty so user re-enters
  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[Kavis] safeStorage decrypt failed:', err);
    return '';
  }
}

/** Read settings from disk and decrypt sensitive fields for the renderer. */
function loadSettingsFile(): Record<string, string> {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const settings = JSON.parse(raw) as Record<string, string>;
    const migrated = migrateSettingsKeys(settings);
    const encryptedAtRest = encryptSensitiveAtRest(migrated);
    const decrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(encryptedAtRest)) {
      decrypted[k] = ENCRYPTED_KEYS.has(k) ? decryptValue(v) : v;
    }
    return decrypted;
  } catch {
    return {};
  }
}

/**
 * One-shot migration: if a sensitive key exists in plaintext on disk,
 * rewrite the file with the encrypted form. Idempotent.
 */
function encryptSensitiveAtRest(settings: Record<string, string>): Record<string, string> {
  let changed = false;
  const next: Record<string, string> = { ...settings };
  for (const k of ENCRYPTED_KEYS) {
    const v = next[k];
    if (!v) continue;
    if (v.startsWith(ENC_PREFIX)) continue;
    const enc = encryptValue(v);
    if (enc !== v) {
      next[k] = enc;
      changed = true;
    }
  }
  if (changed) {
    saveSettingsFile(next);
  }
  return next;
}

/** Migrate legacy janus_* settings keys to kavis_* */
function migrateSettingsKeys(settings: Record<string, string>): Record<string, string> {
  let changed = false;
  const migrated: Record<string, string> = { ...settings };

  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith('janus_')) continue;
    const newKey = 'kavis_' + key.slice('janus_'.length);
    if (!(newKey in migrated)) {
      migrated[newKey] = value;
    }
    delete migrated[key];
    changed = true;
  }

  if (changed) {
    saveSettingsFile(migrated);
  }
  return migrated;
}

function saveSettingsFile(data: Record<string, string>): void {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write to temp file then rename
  const tmp = settingsPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, settingsPath);
}

ipcMain.handle('settings:getAll', () => {
  return loadSettingsFile();
});

ipcMain.handle('settings:set', (_event, key: string, value: string) => {
  if (typeof key !== 'string' || typeof value !== 'string') {
    return false;
  }
  let onDisk: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    onDisk = migrateSettingsKeys(JSON.parse(raw) as Record<string, string>);
  } catch {
    onDisk = {};
  }
  onDisk[key] = ENCRYPTED_KEYS.has(key) ? encryptValue(value) : value;
  saveSettingsFile(onDisk);
  return true;
});

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

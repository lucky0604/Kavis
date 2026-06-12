/**
 * Janus Preload Script
 *
 * Exposes a safe bridge from renderer to main process via contextBridge.
 * Currently minimal — the renderer talks to the embedded server via HTTP/SSE,
 * so no IPC is needed for chat. This bridge is for future native features:
 * - File dialog (select workspace folder)
 * - Native menu actions
 * - System info (platform, paths)
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('janusNative', {
  /** Get the platform (darwin, win32, linux) */
  platform: process.platform,

  /** Open a native folder picker dialog */
  selectFolder: async (): Promise<string | null> => {
    return ipcRenderer.invoke('select-folder');
  },

  /** Get app version */
  getVersion: (): string => {
    return ipcRenderer.sendSync('get-version');
  },

  /** Listen for menu events from main process */
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },

  /** Spawn a new PTY shell process */
  ptyCreate: async (options: { id: string; cwd?: string; cols?: number; rows?: number }): Promise<any> => {
    return ipcRenderer.invoke('pty:create', options);
  },

  /** Write data to PTY stdin */
  ptyWrite: async (args: { id: string; data: string }): Promise<any> => {
    return ipcRenderer.invoke('pty:write', args);
  },

  /** Resize PTY cols/rows */
  ptyResize: async (args: { id: string; cols: number; rows: number }): Promise<any> => {
    return ipcRenderer.invoke('pty:resize', args);
  },

  /** Kill a PTY process and cleanup */
  ptyKill: async (args: { id: string }): Promise<any> => {
    return ipcRenderer.invoke('pty:kill', args);
  },

  /** Listen for PTY data stream from main process */
  onPtyData: (id: string, callback: (data: string) => void) => {
    const channel = `pty:data:${id}`;
    const listener = (_event: any, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  /** Listen for PTY process exits */
  onPtyExit: (id: string, callback: (exitCode: { exitCode: number; signal?: number }) => void) => {
    const channel = `pty:exit:${id}`;
    const listener = (_event: any, exitCode: any) => callback(exitCode);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});

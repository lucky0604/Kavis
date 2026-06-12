/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface JanusNativeBridge {
  platform: string;
  selectFolder: () => Promise<string | null>;
  getVersion: () => string;
  onMenuAction: (callback: (action: string) => void) => void;
  ptyCreate: (options: { id: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ success: boolean; pid?: number; shell?: string; error?: string }>;
  ptyWrite: (args: { id: string; data: string }) => Promise<{ success: boolean; error?: string }>;
  ptyResize: (args: { id: string; cols: number; rows: number }) => Promise<{ success: boolean; error?: string }>;
  ptyKill: (args: { id: string }) => Promise<{ success: boolean; error?: string }>;
  onPtyData: (id: string, callback: (data: string) => void) => () => void;
  onPtyExit: (id: string, callback: (exitCode: { exitCode: number; signal?: number }) => void) => () => void;
}

interface Window {
  janusNative: JanusNativeBridge;
}

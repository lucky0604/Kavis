/**
 * Hook for accessing native Electron bridge functions.
 * Provides safe fallbacks when running in non-Electron environments.
 */
export function useNativeBridge() {
  const selectFolder = async (): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    const win = window as Window & {
      janusNative?: {
        selectFolder?: () => Promise<string | null>;
      };
    };

    if (!win.janusNative?.selectFolder) {
      console.warn('[useNativeBridge] Electron IPC bridge not available');
      return null;
    }

    try {
      return await win.janusNative.selectFolder();
    } catch (err) {
      console.error('[useNativeBridge] selectFolder failed:', err);
      return null;
    }
  };

  return { selectFolder };
}

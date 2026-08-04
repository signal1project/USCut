import { useEffect } from 'react';
import { toast } from 'sonner';

// Mirrors the main-process NOTIFY_CHANNEL constant.
const NOTIFY_CHANNEL = 'mas:notify';

interface MasNotification {
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  at?: number;
}

/**
 * Subscribes to main-process notifications and surfaces them as toasts.
 * Mount once near the app root (or leave unused — Inform handles AutoRun).
 */
export function useMasNotifications(): void {
  useEffect(() => {
    const handler = (_event: unknown, payload: MasNotification) => {
      const msg = payload.body
        ? `${payload.title}: ${payload.body}`
        : payload.title;
      toast[payload.level](msg);
    };
    window.ipcRenderer.on(
      NOTIFY_CHANNEL,
      handler as (event: unknown, ...args: unknown[]) => void,
    );
    return () => {
      window.ipcRenderer.off(NOTIFY_CHANNEL, handler);
    };
  }, []);
}

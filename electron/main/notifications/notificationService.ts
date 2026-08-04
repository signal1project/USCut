export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationPayload {
  level: NotifyLevel;
  title: string;
  body: string;
  /** Epoch ms; set by the service when omitted. */
  at?: number;
}

// OS notification seam (electron.Notification in production).
export interface OsNotifier {
  isSupported(): boolean;
  show(title: string, body: string): void;
}

// Renderer broadcast seam (BrowserWindow.webContents.send in production).
export interface RendererBroadcaster {
  send(channel: string, payload: NotificationPayload): void;
}

export const NOTIFY_CHANNEL = 'mas:notify';

/**
 * Dual notifications: always pushes an in-app toast to the renderer, and raises
 * an OS notification for anything more important than info (when supported).
 */
export class NotificationService {
  constructor(
    private readonly os: OsNotifier,
    private readonly broadcaster: RendererBroadcaster,
  ) {}

  notify(payload: NotificationPayload): void {
    const enriched: NotificationPayload = {
      ...payload,
      at: payload.at ?? Date.now(),
    };
    this.broadcaster.send(NOTIFY_CHANNEL, enriched);
    if (payload.level !== 'info' && this.os.isSupported()) {
      this.os.show(payload.title, payload.body);
    }
  }

  info(title: string, body: string): void {
    this.notify({ level: 'info', title, body });
  }
  success(title: string, body: string): void {
    this.notify({ level: 'success', title, body });
  }
  warning(title: string, body: string): void {
    this.notify({ level: 'warning', title, body });
  }
  error(title: string, body: string): void {
    this.notify({ level: 'error', title, body });
  }
}

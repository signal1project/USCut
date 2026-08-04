import { describe, it, expect, beforeEach } from 'vitest';
import {
  NotificationService,
  NOTIFY_CHANNEL,
  type NotificationPayload,
  type OsNotifier,
  type RendererBroadcaster,
} from '../notificationService';

class FakeOs implements OsNotifier {
  supported = true;
  shown: Array<{ title: string; body: string }> = [];
  isSupported() {
    return this.supported;
  }
  show(title: string, body: string) {
    this.shown.push({ title, body });
  }
}
class FakeBroadcaster implements RendererBroadcaster {
  sent: Array<{ channel: string; payload: NotificationPayload }> = [];
  send(channel: string, payload: NotificationPayload) {
    this.sent.push({ channel, payload });
  }
}

let os: FakeOs;
let bc: FakeBroadcaster;
let svc: NotificationService;

beforeEach(() => {
  os = new FakeOs();
  bc = new FakeBroadcaster();
  svc = new NotificationService(os, bc);
});

describe('NotificationService', () => {
  it('always broadcasts in-app on the notify channel and stamps a timestamp', () => {
    svc.success('Published', 'Your post went live');
    expect(bc.sent).toHaveLength(1);
    expect(bc.sent[0].channel).toBe(NOTIFY_CHANNEL);
    expect(bc.sent[0].payload).toMatchObject({
      level: 'success',
      title: 'Published',
    });
    expect(typeof bc.sent[0].payload.at).toBe('number');
  });

  it('raises an OS notification for non-info levels', () => {
    svc.error('Failed', 'Publish failed');
    expect(os.shown).toEqual([{ title: 'Failed', body: 'Publish failed' }]);
  });

  it('does NOT raise an OS notification for info level', () => {
    svc.info('FYI', 'Just so you know');
    expect(os.shown).toHaveLength(0);
    expect(bc.sent).toHaveLength(1); // still broadcast in-app
  });

  it('skips OS notification when unsupported but still broadcasts', () => {
    os.supported = false;
    svc.warning('Heads up', 'Token expiring soon');
    expect(os.shown).toHaveLength(0);
    expect(bc.sent).toHaveLength(1);
  });
});

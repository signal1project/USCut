import { ipcMain, app, Notification } from 'electron';
import type { DataSource } from 'typeorm';
import fs from 'fs';
import path from 'path';
import { Settings, type SettingsStore } from '../settings/settings';
import { getCredentialManager } from '../credentials';
import { startApiServer, type RunningApiServer } from '../server';
import { startListingCaptureServer, type CaptureServer } from '../listings';
import { buildMasRuntime, type MasRuntime } from './runtime';
import { registerMasIpc } from './ipc';
import { registerExtensionInstallIpc } from '../listings/extensionInstall';
import {
  rehydrateScheduledPosts,
  type PublishNotifier,
} from './scheduledFiring';
import { logger } from '../../global/log';

export interface StartedMas {
  runtime: MasRuntime;
  api: RunningApiServer;
  capture: CaptureServer | null;
}

let started: StartedMas | null = null;

/**
 * Boot the MAS backend: build the runtime, start the loopback API server, and
 * expose its base URL + token to the renderer via IPC ('mas:api-info'). Call
 * once from the main process after the DataSource is initialized.
 */
export async function startMas(
  dataSource: DataSource,
  settingsStore: SettingsStore,
): Promise<StartedMas> {
  if (started) return started;

  const settings = new Settings(settingsStore);
  const credentials = getCredentialManager();

  // Desktop notifications for scheduled-post outcomes (works from the tray).
  const notifyPublish: PublishNotifier = ({ ok, platform, detail }) => {
    try {
      new Notification({
        title: ok
          ? `USCut — posted to ${platform}`
          : `USCut — ${platform} post failed`,
        body: detail,
      }).show();
    } catch {
      /* notifications unavailable — non-fatal */
    }
  };

  const runtime = buildMasRuntime({
    dataSource,
    settings,
    credentials,
    dataDir: app.getPath('userData'),
    notifyPublish,
  });
  const api = await startApiServer({ routes: runtime.routes });

  // Re-register timers for future scheduled posts and catch up any that came
  // due while the app was closed. Async — must not block boot.
  void rehydrateScheduledPosts(
    dataSource,
    runtime.publish,
    runtime.scheduler,
    notifyPublish,
  ).catch((err) =>
    logger.error('[AICut] scheduled-post rehydration failed', err),
  );

  ipcMain.handle('mas:api-info', () => ({
    baseUrl: api.url,
    token: api.token,
  }));
  registerMasIpc({ dataSource, settings, credentials });
  registerExtensionInstallIpc();

  // Write discovery file so local agents (Hermes_Social, Omobono) can find us.
  // Includes the bearer token — same loopback trust model as aicut-bridge.json.
  try {
    const portFile = path.join(app.getPath('userData'), 'api-port.json');
    fs.writeFileSync(
      portFile,
      JSON.stringify({
        port: new URL(api.url).port,
        token: api.token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* non-fatal — Hermes can use manual port override */
  }

  // Fixed-port listener for the Listing Scraper Chrome extension. Guarded:
  // a busy port must never take down the rest of the MAS backend.
  let capture: CaptureServer | null = null;
  try {
    capture = await startListingCaptureServer(runtime.listings);
    logger.log(`[AICut] Listing capture server on ${capture.url}`);
  } catch (err) {
    logger.error(
      '[AICut] Listing capture server failed to start (port busy?)',
      err,
    );
  }

  started = { runtime, api, capture };
  return started;
}

export function getStartedMas(): StartedMas | null {
  return started;
}

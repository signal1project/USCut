/**
 * Renderer-level verification of the aicut-media:// protocol + preview proxy.
 *
 * Launches a hidden BrowserWindow with the SAME webPreferences as the real app
 * (webSecurity on, no node integration) and checks that <video> elements can
 * actually decode frames + seek through the custom protocol:
 *   1. h264 .mp4 → plays directly
 *   2. HEVC .mov original → expected NOT to decode (documents why proxies exist)
 *   3. HEVC .mov → ensurePreviewMedia proxy → plays + seeks
 *
 * Run via: node scripts/verify-media-protocol.mjs <media-dir>
 * (media-dir must contain normal_h264.mp4 + phone_video_hevc.mov — see script)
 */
import { app, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import {
  registerMediaScheme,
  registerMediaProtocolHandler,
} from '../mediaProtocol';
import { probeVideo } from '../ffmpegOps';
import { ensurePreviewMedia } from '../previewProxy';

registerMediaScheme();

const MEDIA_DIR = process.env.AICUT_E2E_MEDIA_DIR ?? '';

function mediaUrl(p: string): string {
  return `aicut-media://media/?p=${encodeURIComponent(p)}`;
}

interface VideoResult {
  status: string;
  w: number;
  h: number;
  dur: number;
}

async function testVideo(
  win: BrowserWindow,
  filePath: string,
): Promise<VideoResult> {
  await win.loadURL(
    'data:text/html,<!doctype html><video id="v" muted></video>',
  );
  const script = `new Promise((resolve) => {
    const v = document.getElementById('v');
    const report = (status) => resolve({ status, w: v.videoWidth, h: v.videoHeight, dur: v.duration });
    v.addEventListener('canplay', () => {
      const onSeeked = () => report('playable+seekable');
      v.addEventListener('seeked', onSeeked, { once: true });
      setTimeout(() => report('playable-seek-timeout'), 4000);
      try { v.currentTime = 1.0; } catch { report('playable-seek-throw'); }
    }, { once: true });
    v.addEventListener('error', () => report('error:' + (v.error ? v.error.code : '?')));
    setTimeout(() => report('timeout-no-canplay'), 8000);
    v.src = ${JSON.stringify(mediaUrl(filePath))};
    v.load();
  })`;
  return (await win.webContents.executeJavaScript(script)) as VideoResult;
}

app
  .whenReady()
  .then(async () => {
    registerMediaProtocolHandler();
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        webSecurity: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const h264 = path.join(MEDIA_DIR, 'normal_h264.mp4');
    const hevc = path.join(MEDIA_DIR, 'phone_video_hevc.mov');

    const results: Record<string, VideoResult | string> = {};
    results['h264_mp4_direct'] = await testVideo(win, h264);
    results['hevc_mov_original'] = await testVideo(win, hevc);

    const probe = await probeVideo(hevc);
    const cacheDir = path.join(os.tmpdir(), `aicut-e2e-proxy-${Date.now()}`);
    const proxy = await ensurePreviewMedia(hevc, probe, cacheDir);
    results['hevc_proxy_built'] = proxy ?? 'NO PROXY BUILT';
    if (proxy) results['hevc_proxy_playback'] = await testVideo(win, proxy);

    console.log('E2E-RESULTS ' + JSON.stringify(results, null, 2));

    const direct = results['h264_mp4_direct'] as VideoResult;
    const proxyPlay = results['hevc_proxy_playback'] as VideoResult | undefined;
    const pass =
      direct?.status === 'playable+seekable' &&
      direct.w > 0 &&
      !!proxy &&
      proxyPlay?.status === 'playable+seekable' &&
      (proxyPlay?.w ?? 0) > 0;

    console.log(pass ? 'E2E-VERDICT PASS' : 'E2E-VERDICT FAIL');
    app.exit(pass ? 0 : 1);
  })
  .catch((err) => {
    console.error('E2E harness crashed:', err);
    app.exit(2);
  });

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Vendored LGPL-licensed FFmpeg build (BtbN/FFmpeg-Builds win64-lgpl-shared,
 * --disable-libx264 --disable-libx265 --enable-version3) — replaces the
 * GPL-3.0 `ffmpeg-static` binary this repo shipped before. Encoding uses
 * `h264_mf` (Windows Media Foundation) instead of `libx264`, since libx264
 * itself is GPL and has no LGPL equivalent to switch to. See
 * docs/LICENSE-INVENTORY.md.
 *
 * Deliberately checks `process.resourcesPath`/`process.defaultApp` instead of
 * importing `electron`'s `app` (which `app.isPackaged` is a thin wrapper
 * around internally) — this module gets pulled into vitest suites that run
 * under plain Node with no Electron runtime and no `electron` mock, so a hard
 * `electron` import would crash them.
 */
function resourceDir(): string {
  const runningInElectron = typeof process.resourcesPath === 'string';
  const isPackaged = runningInElectron && !process.defaultApp;
  return isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg')
    : path.join(__dirname, '../../resources/ffmpeg/win-x64');
}

export function resolveFfmpegPath(): string {
  return path.join(resourceDir(), 'ffmpeg.exe');
}

export function resolveFfprobePath(): string {
  return path.join(resourceDir(), 'ffprobe.exe');
}

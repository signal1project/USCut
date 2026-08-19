import { createRequire } from 'node:module';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// dist-electron/main/index.js is loaded as an ES module (Node's ESM loader,
// not CJS), so a bare `require(...)` has no global to resolve against and
// throws `ReferenceError: require is not defined` — silently caught below,
// which meant this ALWAYS fell back to the ancient no-xfade installer in the
// real running app (dev and packaged alike), never just in tests, since
// vitest runs under plain Node where a bare `require` happens to exist.
// `createRequire` gives a real CJS require bound to this file's own URL,
// which resolves `ffmpeg-static` (a CJS package, kept external in
// vite.config.ts so Rollup doesn't try to bundle its native binary) correctly
// under both ESM and CJS.
const requireCjs = createRequire(import.meta.url);

/**
 * Single source of truth for the ffmpeg binary path.
 *
 * Prefers ffmpeg-static (6.x — needed for xfade transitions, adelay=all,
 * colortemperature, and years of fixes) and falls back to the legacy
 * @ffmpeg-installer binary (a 2018 build) if the static download is missing.
 */
export function resolveFfmpegPath(): string {
  try {
    const staticPath = requireCjs('ffmpeg-static') as string | null;
    if (staticPath) return staticPath.replace('app.asar', 'app.asar.unpacked');
  } catch {
    // fall through to the legacy installer
  }
  return ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked');
}

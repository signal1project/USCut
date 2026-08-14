import { ipcMain, app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { logger } from '../../global/log';

/**
 * Where the built Chrome extension lives. In dev it's a sibling of the repo
 * root (npm run build:ext writes here); in a packaged build it ships as an
 * extraResource (see electron-builder.json) since scripts/build-ext.mjs and
 * esbuild (a devDependency) aren't available inside the packaged app.
 */
function extensionDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'dist-ext')
    : path.join(app.getAppPath(), 'dist-ext');
}

/**
 * Windows has no OS-level "chrome://" protocol registration — only Chrome
 * itself understands that scheme. shell.openExternal() resolves URLs via the
 * OS protocol handler, so it silently fails (or opens the wrong browser) for
 * chrome:// URLs; verified against this machine's registry before writing
 * this. The reliable path is launching chrome.exe directly with the chrome://
 * URL as an argument — Chrome always accepts that. App Paths in the registry
 * is the canonical lookup, but reading it means shelling out to reg.exe for a
 * result that's already knowable from the handful of real install locations,
 * so check those directly instead.
 */
function findChromeExe(): string | null {
  const candidates = [
    process.env['ProgramFiles'] &&
      path.join(
        process.env['ProgramFiles'],
        'Google\\Chrome\\Application\\chrome.exe',
      ),
    process.env['ProgramFiles(x86)'] &&
      path.join(
        process.env['ProgramFiles(x86)'],
        'Google\\Chrome\\Application\\chrome.exe',
      ),
    process.env['LocalAppData'] &&
      path.join(
        process.env['LocalAppData'],
        'Google\\Chrome\\Application\\chrome.exe',
      ),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function registerExtensionInstallIpc(): void {
  ipcMain.handle('listings:extension-info', () => {
    const dir = extensionDir();
    return {
      path: dir,
      built: fs.existsSync(path.join(dir, 'manifest.json')),
      canRebuild: !app.isPackaged,
    };
  });

  ipcMain.handle('listings:build-extension', async () => {
    if (app.isPackaged) {
      throw new Error(
        'The extension ships prebuilt in the packaged app — nothing to build.',
      );
    }
    const cwd = app.getAppPath();
    const script = path.join(cwd, 'scripts', 'build-ext.mjs');
    await new Promise<void>((resolve, reject) => {
      // Run the build script with Electron's own bundled Node runtime
      // (ELECTRON_RUN_AS_NODE) instead of depending on a system `npm` on
      // PATH — same binary Electron itself runs on, always present.
      const child = spawn(process.execPath, [script], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      let stderr = '';
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `build exited with code ${code}`));
      });
    });
    return { path: extensionDir() };
  });

  ipcMain.handle('listings:open-chrome-extensions', async () => {
    const chromePath = findChromeExe();
    if (chromePath) {
      spawn(chromePath, ['chrome://extensions/'], { detached: true }).unref();
      return { opened: true, method: 'chrome' as const };
    }
    // Chrome not found at a known location — best effort, may open the
    // wrong browser or no-op depending on the OS default handler.
    try {
      await shell.openExternal('chrome://extensions/');
    } catch (err) {
      logger.error('[USCut] Could not open chrome://extensions', err);
    }
    return { opened: false, method: 'fallback' as const };
  });

  ipcMain.handle('listings:reveal-extension-folder', () => {
    const dir = extensionDir();
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      shell.showItemInFolder(manifestPath);
    } else {
      shell.openPath(dir);
    }
  });
}

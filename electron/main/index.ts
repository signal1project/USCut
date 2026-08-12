import { app, BrowserWindow, shell, ipcMain, nativeTheme } from 'electron';
import { registerAiCutHandlers } from './aicuts';
import {
  registerMediaScheme,
  registerMediaProtocolHandler,
} from './aicuts/mediaProtocol';

// Must be called before app 'ready' — grants the aicut-media:// scheme
// stream/fetch privileges so <video>/<img> can load local media.
registerMediaScheme();

// WSL / headless GPU environments — use in-process GPU to avoid subprocess crash
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { update } from './update';
import { SystemTray } from '../tray/systemTray';
import { views } from './views';
import App from './app';
import { getAssetPath } from '../util/index';
import windowOperate from '../util/windowOperate';
import { logger } from '../global/log';
import { SplashWindow } from './splash';
import dotenv from 'dotenv';
import { registerContextMenuListener } from '@electron-uikit/contextmenu';
import { dialog } from 'electron';
import fs from 'node:fs';
import { startApiServer } from './server';
import { createAicutAgentRouter } from './aicuts/agentApi';
import { initSqlite3Db, AppDataSource } from '../db';
import { store } from '../global/store';
import { startMas } from './mas/startup';
import { registerWebviewBridge } from './adapters/webviewBridge';

const platform = process.platform;
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

dialog.showErrorBox = (title, content) => {
  console.error(`Error: ${title}\n${content}`);
};

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration();

if (process.platform === 'win32') app.setAppUserModelId('USCut');

let win: BrowserWindow | null = null;
let splashWindow: SplashWindow | null = null;
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});
const preload = path.join(__dirname, '../preload/index.mjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');

async function createWindow() {
  splashWindow = new SplashWindow();
  splashWindow.create();

  await new Promise((resolve) => setTimeout(resolve, 500));

  win = new BrowserWindow({
    title: 'USCut',
    icon: path.join(getAssetPath('favicon.ico')),
    width: 2350,
    height: 1280,
    minWidth: 1280,
    minHeight: 800,
    titleBarStyle: 'hidden',
    show: false,
    titleBarOverlay:
      platform === 'win32'
        ? undefined
        : {
            color: 'rgba(0,0,0,0)',
            height: 64,
            symbolColor: '#595959',
          },
    webPreferences: {
      preload,
      webviewTag: true,
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  nativeTheme.themeSource = 'dark';

  try {
    const tray = new SystemTray(win);
    tray.create();
  } catch (error) {
    logger.error('System tray failed to start', error);
  }

  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(indexHtml);
  }

  const startHidden = process.argv.includes('--hidden');
  setTimeout(() => {
    if (splashWindow) {
      if (!startHidden) win?.show();

      if (process.env.NODE_ENV === 'development') {
        win?.webContents.openDevTools({ mode: 'right' });
      }

      setTimeout(() => {
        if (splashWindow) {
          splashWindow.close();
          splashWindow = null;
        }
      }, 100);
    }
  }, 500);

  win.setMenu(null);

  // Close-to-tray: the scheduler must survive the window closing, or
  // scheduled posts silently die with it. Quit explicitly via tray menu.
  win.on('close', (e) => {
    const keepInTray = store.get('app.keepInTray') ?? true;
    if (keepInTray && !isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/**
 * Start the headless Agent Bridge so Omobono / Apollo / any MCP client can drive
 * AICut without the GUI. Binds loopback-only on AICUT_BRIDGE_PORT (default 4255)
 * and writes a discovery file (url + bearer token) to userData so agents can find
 * it. See electron/main/aicuts/agentApi.ts for the routes.
 */
async function startAgentBridge() {
  try {
    const port = Number(process.env.AICUT_BRIDGE_PORT) || 4255;
    const token = process.env.AICUT_BRIDGE_TOKEN;
    const api = await startApiServer({
      port,
      token,
      routes: [{ path: '/aicut', router: createAicutAgentRouter() }],
    });
    const info = {
      url: api.url,
      port: api.port,
      token: api.token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    const discoveryFile = path.join(
      app.getPath('userData'),
      'aicut-bridge.json',
    );
    fs.writeFileSync(discoveryFile, JSON.stringify(info, null, 2));
    logger.log(
      `[AICut] Agent bridge listening on ${api.url} (discovery: ${discoveryFile})`,
    );
  } catch (err) {
    logger.error('[AICut] Agent bridge failed to start', err);
  }
}

/**
 * Boot the full MAS backend: DB init, publish engine, research/scraper,
 * scheduling, OAuth IPC, and the loopback REST API server. Replaces the old
 * onboarding-only stub. Guarded so any failure never blocks the video editor.
 */
async function startMasBackend() {
  try {
    const ok = await initSqlite3Db();
    if (!ok) {
      logger.error('[AICut] DB init failed — MAS backend disabled');
      return;
    }
    await startMas(AppDataSource, store);
    logger.log(
      '[AICut] MAS backend ready (publish, research, scheduling, OAuth)',
    );
  } catch (err) {
    logger.error('[AICut] MAS backend failed to start', err);
  }
}

app.whenReady().then(async () => {
  try {
    registerMediaProtocolHandler();
    registerContextMenuListener();
    new App();
    const bWin = await createWindow();
    registerAiCutHandlers(bWin);
    registerWebviewBridge(bWin);
    await startAgentBridge();
    await startMasBackend();
    update(bWin);
    views(bWin);
    windowOperate.init(bWin);
  } catch (error) {
    logger.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  win = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

// Background behavior preferences (Settings → App)
ipcMain.handle('app:get-background-prefs', () => ({
  keepInTray: (store.get('app.keepInTray') as boolean | undefined) ?? true,
  launchAtLogin: app.getLoginItemSettings().openAtLogin,
}));

ipcMain.handle(
  'app:set-background-prefs',
  (_e, prefs: { keepInTray?: boolean; launchAtLogin?: boolean }) => {
    if (typeof prefs.keepInTray === 'boolean') {
      store.set('app.keepInTray', prefs.keepInTray);
    }
    if (typeof prefs.launchAtLogin === 'boolean') {
      app.setLoginItemSettings({
        openAtLogin: prefs.launchAtLogin,
        // Start hidden in the tray so login doesn't pop the editor.
        args: ['--hidden'],
      });
    }
    return { ok: true };
  },
);

ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});

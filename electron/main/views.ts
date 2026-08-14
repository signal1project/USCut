import { dialog, ipcMain, app } from 'electron';
import fs from 'fs';
import { FileUtils } from '../util/file';
import path from 'path';
import { logger } from '../global/log';

export interface ISaveFileParams {
  saveDir: string;
  filename: string;
  file: Uint8Array;
}

// Channels registered by views() — guarded with removeHandler so Electron dev
// hot-reload (which re-calls views()) never throws "second handler" errors.
const VIEW_CHANNELS = [
  'app:info',
  'window-minimize',
  'window-maximize',
  'window-close',
  'OPEN_DEV_TOOLS',
  'ICP_VIEWS_SAVE_FILE',
  'ICP_VIEWS_GET_FILE_STREAM',
  'ICP_VIEWS_CHOSE_VIDEO',
  'ICP_VIEWS_CHOSE_IMG',
] as const;

export function views(win: Electron.BrowserWindow) {
  // Clear any previous handlers so hot-reload never double-registers.
  for (const ch of VIEW_CHANNELS) ipcMain.removeHandler(ch);

  // Provides platform info to the renderer (used by WindowControlButtons)
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    name: app.getName(),
  }));

  // Minimize is the dedicated "send to tray" action (Dale's call,
  // 2026-08-14) — the X button quits for real by default now, so this is
  // the explicit alternate path to background/tray behavior instead of a
  // plain OS taskbar-minimize.
  ipcMain.handle('window-minimize', function () {
    win.hide();
  });

  ipcMain.handle('window-maximize', function () {
    if (win.isMaximized()) {
      win.restore();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle('window-close', function () {
    win.close();
  });

  ipcMain.handle('OPEN_DEV_TOOLS', () => {
    win.webContents.openDevTools({ mode: 'right' });
  });

  ipcMain.handle(
    'ICP_VIEWS_SAVE_FILE',
    (event, { saveDir, filename, file }: ISaveFileParams) => {
      return new Promise(async (resolve) => {
        const outputDir = path.join(
          FileUtils.getAppDataPath()!,
          'resource/images/cropper',
        );
        await FileUtils.checkDirectories(outputDir + saveDir);
        const filePath = outputDir + saveDir + '/' + filename;
        fs.writeFile(filePath, file, (err) => {
          if (err) {
            logger.error('Save file error', err);
          } else {
            logger.info('File saved:', filePath);
            resolve(filePath);
          }
        });
      });
    },
  );

  ipcMain.handle(
    'ICP_VIEWS_GET_FILE_STREAM',
    async (event, filePath: string) => {
      return fs.readFileSync(filePath);
    },
  );

  ipcMain.handle('ICP_VIEWS_CHOSE_VIDEO', async (event, isMultiSelections) => {
    const properties = ['openFile'];
    if (isMultiSelections) properties.push('multiSelections');
    try {
      const result = await dialog.showOpenDialog({
        properties: properties as Array<'openFile'>,
        filters: [{ name: 'Video files', extensions: ['mp4', 'mov'] }],
      });
      if (result.canceled) return null;
      return result.filePaths.map((v) => ({
        path: v,
        video: fs.readFileSync(v),
      }));
    } catch (error) {
      console.error('Error selecting video:', error);
      return null;
    }
  });

  ipcMain.handle('ICP_VIEWS_CHOSE_IMG', async (event, isMultiSelections) => {
    const properties = ['openFile'];
    if (isMultiSelections) properties.push('multiSelections');
    try {
      const result = await dialog.showOpenDialog({
        properties: properties as Array<'openFile'>,
        filters: [{ name: 'Image files', extensions: ['jpg', 'png', 'jpeg'] }],
      });
      return result.filePaths.map((v) => ({
        path: v,
        file: fs.readFileSync(v),
      }));
    } catch (error) {
      console.error('Error selecting image:', error);
      return '';
    }
  });
}

/*
 * @Author: nevin
 * @Date: 2025-02-21 21:10:01
 * @LastEditTime: 2025-02-21 21:12:28
 * @LastEditors: nevin
 * @Description: 存储
 */
import { ipcMain, safeStorage } from 'electron';
import {
  SecureSettingsStore,
  assertPublicStoreKey,
  type MutableStore,
} from '../main/settings/secureSettingsStore';
import Store from 'electron-store';

export const store: any = new Store();
const secretStore = new Store({ name: 'uscut-ai-credentials' });
export const settingsStore = new SecureSettingsStore(
  store,
  secretStore as unknown as MutableStore,
  safeStorage,
);
// 定义ipcRenderer监听事件
ipcMain.handle('setStore', (_, key, value) => {
  assertPublicStoreKey(key);
  store.set(key, value);
});
ipcMain.handle('getStore', async (_, key) => {
  assertPublicStoreKey(key);
  const value = store.get(key);
  return value || '';
});

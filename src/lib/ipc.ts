/**
 * Safe accessor for the Electron preload IPC bridge.
 *
 * In Electron, `window.ipcRenderer` is exposed by electron/preload/index.ts.
 * In a plain browser (e.g. Vite dev at localhost:5173, or tests) it is
 * undefined. Touching it directly there throws and — because the call sites
 * live above the router Outlet — takes down the whole app via the
 * ErrorBoundary, presenting as a "blank screen".
 *
 * `ipc` returns the real bridge when present, otherwise a no-op stub whose
 * `invoke` resolves to `undefined`, so the UI renders and runs identically in
 * the browser. Use `hasIpc()` when behaviour should differ without a bridge.
 */
type IpcBridge = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
  send: (channel: string, ...args: unknown[]) => void;
  getStoreValue: (key: string) => Promise<unknown>;
  setStoreValue: (key: string, value: unknown) => void;
};

const noop = () => {};

const stub: IpcBridge = {
  invoke: () => Promise.resolve(undefined),
  on: noop,
  off: noop,
  send: noop,
  getStoreValue: () => Promise.resolve(undefined),
  setStoreValue: noop,
};

export function hasIpc(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { ipcRenderer?: unknown }).ipcRenderer
  );
}

export const ipc: IpcBridge =
  typeof window !== 'undefined' &&
  (window as { ipcRenderer?: IpcBridge }).ipcRenderer
    ? (window as unknown as { ipcRenderer: IpcBridge }).ipcRenderer
    : stub;

// Ambient typing for the preload-exposed IPC bridge used by MAS renderer code.
export {};

declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void,
      ): void;
      off(channel: string, ...args: unknown[]): void;
    };
  }
}

import { safeStorage } from 'electron';
import Store from 'electron-store';
import {
  CredentialManager,
  type CredentialStore,
  type SecureEncryptor,
} from './credentialManager';

export { CredentialManager } from './credentialManager';
export type { SecureEncryptor, CredentialStore } from './credentialManager';

const safeStorageEncryptor: SecureEncryptor = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plain) => safeStorage.encryptString(plain),
  decryptString: (enc) => safeStorage.decryptString(enc),
};

// Dedicated store, NOT the IPC-exposed global one — credentials must never be
// reachable through the renderer's getStore/setStore channels.
const credentialStore = new Store({
  name: 'mas-credentials',
}) as unknown as CredentialStore;

let instance: CredentialManager | null = null;

/** Lazily build the production CredentialManager (requires the Electron app). */
export function getCredentialManager(): CredentialManager {
  if (!instance) {
    instance = new CredentialManager(safeStorageEncryptor, credentialStore);
  }
  return instance;
}

import type { SecureEncryptor } from '../credentials/credentialManager';
import type { SettingsStore } from './settings';

export interface MutableStore extends SettingsStore {
  delete(key: string): void;
}

export const SECRET_ROOTS = [
  'mas.settings.ai.key',
  'mas.settings.ai.chatgpt.tokens',
  'mas.settings.tts.elevenlabs.key',
  'mas.settings.oauth',
];

export function isSecretSetting(key: string): boolean {
  return SECRET_ROOTS.some(
    (root) => key === root || key.startsWith(root + '.'),
  );
}

/** Deny both secret leaves and their ancestors to generic renderer storage. */
export function assertPublicStoreKey(key: unknown): asserts key is string {
  if (
    typeof key !== 'string' ||
    !key ||
    key
      .split('.')
      .some(
        (p) => !p || ['__proto__', 'prototype', 'constructor'].includes(p),
      ) ||
    SECRET_ROOTS.some(
      (root) =>
        key === root ||
        key.startsWith(root + '.') ||
        root.startsWith(key + '.'),
    )
  ) {
    throw new Error(
      'This setting is available only through the dedicated settings interface.',
    );
  }
}

export class SecureSettingsStore implements SettingsStore {
  constructor(
    private readonly plain: MutableStore,
    private readonly secure: MutableStore,
    private readonly encryptor: SecureEncryptor,
  ) {}

  private check(): void {
    if (!this.encryptor.isEncryptionAvailable()) {
      throw new Error(
        'OS secure storage is unavailable. AI credentials cannot be accessed.',
      );
    }
  }

  get(key: string): unknown {
    if (!isSecretSetting(key)) return this.plain.get(key);
    const encrypted = this.secure.get(key);
    if (typeof encrypted === 'string') {
      this.check();
      const value = JSON.parse(
        this.encryptor.decryptString(Buffer.from(encrypted, 'base64')),
      );
      // Complete an interrupted migration only after successful decryption.
      if (this.plain.get(key) !== undefined) this.plain.delete(key);
      return value;
    }
    const legacy = this.plain.get(key);
    if (legacy === undefined) return undefined;
    this.set(key, legacy);
    return legacy;
  }

  set(key: string, value: unknown): void {
    if (!isSecretSetting(key)) {
      this.plain.set(key, value);
      return;
    }
    this.check();
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Invalid credential value.');
    const encrypted = this.encryptor.encryptString(json).toString('base64');
    this.secure.set(key, encrypted);
    // Verify durable ciphertext before removing the legacy plaintext.
    const saved = this.secure.get(key);
    if (
      typeof saved !== 'string' ||
      this.encryptor.decryptString(Buffer.from(saved, 'base64')) !== json
    ) {
      throw new Error(
        'Credential migration could not be verified. Existing settings were preserved.',
      );
    }
    this.plain.delete(key);
  }

  migrate(): void {
    for (const root of ['mas.settings.ai.key', 'mas.settings.oauth']) {
      const values = this.plain.get(root);
      if (values && typeof values === 'object') {
        for (const name of Object.keys(values)) this.get(`${root}.${name}`);
      }
    }
    this.get('mas.settings.ai.chatgpt.tokens');
    this.get('mas.settings.tts.elevenlabs.key');
  }
}

import { describe, expect, it } from 'vitest';
import {
  SecureSettingsStore,
  assertPublicStoreKey,
  type MutableStore,
} from '../secureSettingsStore';
import type { SecureEncryptor } from '../../credentials/credentialManager';

function memory(): MutableStore {
  const values = new Map<string, unknown>();
  return {
    get: (k) => values.get(k),
    set: (k, v) => {
      values.set(k, v);
    },
    delete: (k) => {
      values.delete(k);
    },
  };
}
const encryptor: SecureEncryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('encrypted:' + s),
  decryptString: (b) => {
    const text = b.toString();
    if (!text.startsWith('encrypted:')) throw new Error('Cannot decrypt');
    return text.slice(10);
  },
};
describe('protected AI settings', () => {
  it('migrates legacy values and persists updated tokens across instances', () => {
    const plain = memory();
    const secure = memory();
    const key = 'mas.settings.ai.chatgpt.tokens';
    plain.set(key, { accessToken: 'old', refreshToken: 'refresh' });
    const store = new SecureSettingsStore(plain, secure, encryptor);
    store.migrate();
    expect(plain.get(key)).toBeUndefined();
    expect(secure.get(key)).not.toContain('refresh');
    expect(store.get(key)).toEqual({
      accessToken: 'old',
      refreshToken: 'refresh',
    });
    store.set(key, { accessToken: 'new' });
    expect(new SecureSettingsStore(plain, secure, encryptor).get(key)).toEqual({
      accessToken: 'new',
    });
    store.set(key, null);
    expect(store.get(key)).toBeNull();
  });
  it('keeps the original when encryption or persistence fails', () => {
    const key = 'mas.settings.ai.key.openai';
    const plain = memory();
    plain.set(key, 'original');
    const unavailable = new SecureSettingsStore(plain, memory(), {
      ...encryptor,
      isEncryptionAvailable: () => false,
    });
    expect(() => unavailable.get(key)).toThrow('unavailable');
    expect(plain.get(key)).toBe('original');
    const broken = {
      ...memory(),
      set: () => {
        throw new Error('disk full');
      },
    };
    expect(() =>
      new SecureSettingsStore(plain, broken, encryptor).get(key),
    ).toThrow('disk full');
    expect(plain.get(key)).toBe('original');
  });
  it('does not delete legacy data if ciphertext cannot be decrypted', () => {
    const key = 'mas.settings.tts.elevenlabs.key';
    const plain = memory();
    const secure = memory();
    plain.set(key, 'original');
    secure.set(key, Buffer.from('corrupt').toString('base64'));
    expect(() =>
      new SecureSettingsStore(plain, secure, encryptor).get(key),
    ).toThrow();
    expect(plain.get(key)).toBe('original');
  });
  it.each([
    'mas',
    'mas.settings',
    'mas.settings.ai',
    'mas.settings.ai.key.openai',
    'mas.settings.oauth.facebook',
    'mas.settings.ai.chatgpt.tokens.accessToken',
    '',
    '__proto__.x',
    null,
  ])('denies renderer access to %s', (key) => {
    expect(() => assertPublicStoreKey(key)).toThrow();
  });
  it('keeps public settings accessible', () => {
    assertPublicStoreKey('app.keepInTray');
    const plain = memory();
    const secure = memory();
    const store = new SecureSettingsStore(plain, secure, encryptor);
    store.set('app.keepInTray', true);
    expect(plain.get('app.keepInTray')).toBe(true);
    expect(secure.get('app.keepInTray')).toBeUndefined();
  });
});

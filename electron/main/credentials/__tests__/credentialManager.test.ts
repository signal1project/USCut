import { describe, it, expect, beforeEach } from 'vitest';
import type { TokenBundle } from '@mas/types';
import {
  CredentialManager,
  type CredentialStore,
  type SecureEncryptor,
} from '../credentialManager';

// Reversible fake: prefixes a tag so we can assert data was actually "encrypted"
// (i.e. round-tripped through the encryptor) rather than stored as plaintext.
function makeFakeEncryptor(
  available = true,
): SecureEncryptor & { lastPlain?: string } {
  const tag = 'ENC:';
  return {
    isEncryptionAvailable: () => available,
    encryptString(plain: string) {
      this.lastPlain = plain;
      return Buffer.from(tag + plain, 'utf8');
    },
    decryptString(enc: Buffer) {
      const s = enc.toString('utf8');
      if (!s.startsWith(tag)) throw new Error('bad ciphertext');
      return s.slice(tag.length);
    },
  };
}

function makeMapStore(): CredentialStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k),
    has: (k) => map.has(k),
  };
}

const bundle: TokenBundle = {
  accessToken: 'at-123',
  refreshToken: 'rt-456',
  tokenType: 'Bearer',
  scope: 'pages_manage_posts',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  obtainedAt: new Date('2026-05-21T00:00:00Z'),
  meta: { pageId: 'p1' },
};

let enc: ReturnType<typeof makeFakeEncryptor>;
let store: ReturnType<typeof makeMapStore>;
let mgr: CredentialManager;

beforeEach(() => {
  enc = makeFakeEncryptor();
  store = makeMapStore();
  mgr = new CredentialManager(enc, store);
});

describe('CredentialManager', () => {
  it('builds a stable ref from platform + externalId', () => {
    expect(CredentialManager.refFor('facebook', 'acc-1')).toBe(
      'facebook:acc-1',
    );
  });

  it('saves encrypted (never plaintext) and round-trips the bundle', () => {
    const ref = 'facebook:acc-1';
    mgr.save(ref, bundle);

    const raw = store.map.get('mas.credentials.facebook:acc-1');
    expect(raw).toBeDefined();
    expect(raw).not.toContain('at-123'); // not stored in the clear

    const got = mgr.retrieve(ref);
    expect(got?.accessToken).toBe('at-123');
    expect(got?.refreshToken).toBe('rt-456');
    expect(got?.meta).toEqual({ pageId: 'p1' });
    expect(got?.expiresAt).toEqual(new Date('2030-01-01T00:00:00Z'));
  });

  it('returns null for a missing ref', () => {
    expect(mgr.retrieve('nope')).toBeNull();
  });

  it('reports presence and deletes', () => {
    mgr.save('x:1', bundle);
    expect(mgr.has('x:1')).toBe(true);
    mgr.delete('x:1');
    expect(mgr.has('x:1')).toBe(false);
    expect(mgr.retrieve('x:1')).toBeNull();
  });

  it('rejects an invalid bundle (empty access token)', () => {
    expect(() => mgr.save('x:1', { ...bundle, accessToken: '' })).toThrow();
  });

  it('throws when OS encryption is unavailable', () => {
    const m = new CredentialManager(makeFakeEncryptor(false), makeMapStore());
    expect(() => m.save('x:1', bundle)).toThrow(
      /secure storage is unavailable/,
    );
  });
});

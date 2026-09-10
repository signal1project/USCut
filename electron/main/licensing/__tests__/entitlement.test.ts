import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  signEntitlement,
  verifyEntitlement,
  ENTITLEMENT_PRODUCT,
  type EntitlementClaims,
} from '../../../../commont/entitlement';
import {
  resolveLicenseStatus,
  isPremiumUnlocked,
  OFFLINE_GRACE_DAYS,
} from '../entitlement';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const NOW = 1_800_000_000;
const claims = (over: Partial<EntitlementClaims> = {}): EntitlementClaims => ({
  sub: 'dale@example.com',
  product: ENTITLEMENT_PRODUCT,
  plan: 'pro-monthly',
  customer: 'cus_123',
  iat: NOW - 3600,
  exp: NOW + 30 * 86400,
  jti: 'ent_1',
  ...over,
});

describe('entitlement token crypto', () => {
  it('rejects signed but invalid subscription claims', () => {
    for (const over of [
      { sub: '' },
      { plan: ' ' },
      { jti: '' },
      { exp: Infinity },
      { exp: NOW + 0.5 },
      { exp: NOW - 7200 },
      { iat: -1 },
    ]) {
      expect(
        verifyEntitlement(signEntitlement(claims(over), priv), pub, NOW).valid,
      ).toBe(false);
    }
    expect(
      verifyEntitlement(signEntitlement(claims(), priv), 'invalid key', NOW)
        .valid,
    ).toBe(false);
    expect(verifyEntitlement('x'.repeat(20000), pub, NOW).valid).toBe(false);
  });
  it('round-trips sign → verify with the matching key', () => {
    const token = signEntitlement(claims(), priv);
    const check = verifyEntitlement(token, pub, NOW);
    expect(check.valid).toBe(true);
    expect(check.valid && check.claims.sub).toBe('dale@example.com');
  });

  it('rejects a token signed by a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const token = signEntitlement(claims(), other);
    expect(verifyEntitlement(token, pub, NOW)).toMatchObject({
      valid: false,
      reason: 'bad signature',
    });
  });

  it('rejects a tampered payload', () => {
    const token = signEntitlement(claims(), priv);
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify(claims({ plan: 'enterprise' })),
    ).toString('base64url');
    expect(verifyEntitlement(`${forged}.${sig}`, pub, NOW).valid).toBe(false);
  });

  it('reports expiry and refuses to sign a non-USCut product', () => {
    const token = signEntitlement(claims({ exp: NOW - 10 }), priv);
    expect(verifyEntitlement(token, pub, NOW)).toMatchObject({
      valid: false,
      reason: 'expired',
    });
    expect(() =>
      signEntitlement(claims({ product: 'other' as never }), priv),
    ).toThrow();
  });
});

describe('resolveLicenseStatus + offline grace', () => {
  const status = (token: string | null, now = NOW) =>
    resolveLicenseStatus(token, null, now, pub);

  it('is unlicensed with no token', () => {
    expect(status(null).state).toBe('unlicensed');
  });

  it('is active for a valid unexpired token', () => {
    const s = status(signEntitlement(claims(), priv));
    expect(s).toMatchObject({ state: 'active', plan: 'pro-monthly' });
  });

  it('enters grace within the offline window, then expires', () => {
    const token = signEntitlement(claims({ exp: NOW }), priv);
    const inGrace = status(token, NOW + 3 * 86400);
    expect(inGrace.state).toBe('grace');
    expect(isPremiumUnlocked(inGrace)).toBe(true);
    const afterGrace = status(token, NOW + (OFFLINE_GRACE_DAYS + 1) * 86400);
    expect(afterGrace.state).toBe('expired');
    expect(isPremiumUnlocked(afterGrace)).toBe(false);
  });

  it('marks a wrong-key token invalid, not expired', () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    expect(status(signEntitlement(claims(), other)).state).toBe('invalid');
  });
});

import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * USCut subscription entitlement — a compact, offline-verifiable token.
 *
 * `<base64url(JSON claims)>.<base64url(ed25519 signature)>`
 *
 * The desktop app bundles ONLY the ed25519 public key and calls
 * `verifyEntitlement`. The licensing service holds the private key and calls
 * `signEntitlement` from its Stripe webhook. No signing secret ever ships in
 * the app.
 */

export const ENTITLEMENT_PRODUCT = 'uscut';

export interface EntitlementClaims {
  /** Subscriber identity (Stripe customer email, lower-cased). */
  sub: string;
  product: typeof ENTITLEMENT_PRODUCT;
  /** Price/tier id, free-form (e.g. "pro-monthly"). */
  plan: string;
  /** Stripe customer id, for support correlation. */
  customer?: string;
  /** Issued-at / expiry, seconds since epoch. `exp` is the paid-through date. */
  iat: number;
  exp: number;
  /** Unique id — lets a future revocation list name a specific token. */
  jti: string;
}

function b64urlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function b64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signEntitlement(
  claims: EntitlementClaims,
  privateKeyPem: string | KeyObject,
): string {
  if (claims.product !== ENTITLEMENT_PRODUCT)
    throw new Error('Refusing to sign a non-USCut entitlement');
  const key =
    typeof privateKeyPem === 'string'
      ? createPrivateKey(privateKeyPem)
      : privateKeyPem;
  const payload = b64urlEncode(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = edSign(null, Buffer.from(payload), key);
  return `${payload}.${b64urlEncode(signature)}`;
}

export type EntitlementCheck =
  | { valid: true; claims: EntitlementClaims }
  | { valid: false; reason: string; claims?: EntitlementClaims };

export function verifyEntitlement(
  token: string,
  publicKeyPem: string | KeyObject,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): EntitlementCheck {
  const parts = typeof token === 'string' ? token.trim().split('.') : [];
  if (parts.length !== 2) return { valid: false, reason: 'malformed token' };
  let claims: EntitlementClaims;
  try {
    claims = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  } catch {
    return { valid: false, reason: 'unreadable token' };
  }
  const key =
    typeof publicKeyPem === 'string'
      ? createPublicKey(publicKeyPem)
      : publicKeyPem;
  let signatureOk = false;
  try {
    signatureOk = edVerify(
      null,
      Buffer.from(parts[0]),
      key,
      b64urlDecode(parts[1]),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { valid: false, reason: 'bad signature' };
  if (claims.product !== ENTITLEMENT_PRODUCT)
    return { valid: false, reason: 'not a USCut licence', claims };
  if (
    typeof claims.sub !== 'string' ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number'
  )
    return { valid: false, reason: 'incomplete claims', claims };
  if (nowSeconds >= claims.exp)
    return { valid: false, reason: 'expired', claims };
  if (claims.iat - 86400 > nowSeconds)
    return { valid: false, reason: 'not yet valid', claims };
  return { valid: true, claims };
}

// Mirrors commont/entitlement.ts (the app's verifier). Kept as plain ESM so the
// service has zero build step. If these drift, the app rejects real licences —
// the app repo's entitlement.test.ts is the contract.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const ENTITLEMENT_PRODUCT = 'uscut';

const b64u = (buf) =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signEntitlement(claims, privateKeyPem) {
  if (claims.product !== ENTITLEMENT_PRODUCT)
    throw new Error('Refusing to sign a non-USCut entitlement');
  const key = createPrivateKey(privateKeyPem);
  const payload = b64u(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payload}.${b64u(sign(null, Buffer.from(payload), key))}`;
}

export function verifyEntitlement(
  token,
  publicKeyPem,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const parts = String(token).trim().split('.');
  if (
    typeof token !== 'string' ||
    token.length > 16384 ||
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    return { valid: false, reason: 'malformed token' };
  let claims;
  try {
    claims = JSON.parse(unb64u(parts[0]).toString('utf8'));
  } catch {
    return { valid: false, reason: 'unreadable token' };
  }
  let ok = false;
  try {
    ok = verify(
      null,
      Buffer.from(parts[0]),
      createPublicKey(publicKeyPem),
      unb64u(parts[1]),
    );
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'bad signature' };
  if (!claims || typeof claims !== 'object')
    return { valid: false, reason: 'incomplete claims' };
  if (claims.product !== ENTITLEMENT_PRODUCT)
    return { valid: false, reason: 'not a USCut licence', claims };
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub.trim() ||
    claims.sub.length > 320 ||
    typeof claims.plan !== 'string' ||
    !claims.plan.trim() ||
    claims.plan.length > 200 ||
    typeof claims.jti !== 'string' ||
    !claims.jti.trim() ||
    claims.jti.length > 300 ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat < 0 ||
    claims.exp <= claims.iat ||
    !Number.isFinite(nowSeconds)
  )
    return { valid: false, reason: 'incomplete claims', claims };
  if (nowSeconds >= claims.exp)
    return { valid: false, reason: 'expired', claims };
  if (claims.iat - 86400 > nowSeconds)
    return { valid: false, reason: 'not yet valid', claims };
  return { valid: true, claims };
}

/** Build the claims for a Stripe subscription's current state. */
export function entitlementForSubscription({
  email,
  plan,
  customer,
  periodEndSeconds,
}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: String(email).toLowerCase(),
    product: ENTITLEMENT_PRODUCT,
    plan,
    customer,
    iat: now,
    exp: periodEndSeconds,
    jti: `ent_${customer}_${periodEndSeconds}`,
  };
}

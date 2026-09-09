import {
  verifyEntitlement,
  type EntitlementClaims,
} from '../../../commont/entitlement';

/**
 * USCut licence verification public key (ed25519, SPKI PEM).
 *
 * The matching PRIVATE key lives only in the licensing service
 * (`services/licensing`) and its Stripe webhook. It is never in this app or
 * this repository. To rotate: generate a new ed25519 pair, replace this
 * constant, ship an app update, and re-issue outstanding entitlements.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcNbGCiR/5c4nw8DlM1slpkxfpQDO2UxY02EVHgQiAEQ=
-----END PUBLIC KEY-----`;

/** Days a verified entitlement keeps working past its paid-through date while
 * the app cannot reach the licensing service to refresh it. */
export const OFFLINE_GRACE_DAYS = 14;

export type LicenseState =
  | 'unlicensed'
  | 'active'
  | 'grace'
  | 'expired'
  | 'invalid';

export interface LicenseStatus {
  state: LicenseState;
  plan: string | null;
  email: string | null;
  /** Paid-through date (ISO) when known. */
  expiresAt: string | null;
  /** When `state === 'grace'`, the app locks premium features after this. */
  graceUntil: string | null;
  detail: string;
}

const UNLICENSED: LicenseStatus = {
  state: 'unlicensed',
  plan: null,
  email: null,
  expiresAt: null,
  graceUntil: null,
  detail: 'No subscription connected.',
};

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Resolves a stored token + last-verified timestamp into a display/gating
 * status. Pure — the caller supplies `now` and the persisted values.
 */
export function resolveLicenseStatus(
  token: string | null,
  lastVerifiedSeconds: number | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM,
): LicenseStatus {
  if (!token) return UNLICENSED;
  const check = verifyEntitlement(token, publicKeyPem, nowSeconds);
  if (check.valid) {
    return {
      state: 'active',
      plan: check.claims.plan,
      email: check.claims.sub,
      expiresAt: iso(check.claims.exp),
      graceUntil: null,
      detail: `Active until ${iso(check.claims.exp).slice(0, 10)}.`,
    };
  }
  const claims = check.claims as EntitlementClaims | undefined;
  if (check.reason === 'expired' && claims) {
    const graceEnd = claims.exp + OFFLINE_GRACE_DAYS * 86400;
    if (nowSeconds < graceEnd)
      return {
        state: 'grace',
        plan: claims.plan,
        email: claims.sub,
        expiresAt: iso(claims.exp),
        graceUntil: iso(graceEnd),
        detail:
          'Your subscription needs renewing. Premium features keep working ' +
          `until ${iso(graceEnd).slice(0, 10)} while USCut re-checks it.`,
      };
    return {
      state: 'expired',
      plan: claims.plan,
      email: claims.sub,
      expiresAt: iso(claims.exp),
      graceUntil: iso(graceEnd),
      detail: 'Subscription expired. Renew to restore premium features.',
    };
  }
  void lastVerifiedSeconds;
  return {
    state: 'invalid',
    plan: null,
    email: claims?.sub ?? null,
    expiresAt: null,
    graceUntil: null,
    detail: `Licence could not be verified (${check.reason}).`,
  };
}

/** Whether premium (paid-tier) features should be unlocked for this status. */
export function isPremiumUnlocked(status: LicenseStatus): boolean {
  return status.state === 'active' || status.state === 'grace';
}

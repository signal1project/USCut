// Offline lifecycle check for the licensing scaffold. No Stripe, no network.
// Run: node test-lifecycle.mjs
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  entitlementForSubscription,
  signEntitlement,
  verifyEntitlement,
} from './entitlement.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });

const now = Math.floor(Date.now() / 1000);

// 1. New subscription
let token = signEntitlement(
  entitlementForSubscription({
    email: 'Buyer@Example.com',
    plan: 'pro-monthly',
    customer: 'cus_1',
    periodEndSeconds: now + 30 * 86400,
  }),
  priv,
);
let check = verifyEntitlement(token, pub, now);
assert.equal(check.valid, true);
assert.equal(check.claims.sub, 'buyer@example.com'); // normalised
console.log('PASS: new subscription issues a valid, verifiable token');

// 2. Renewal extends the period
token = signEntitlement(
  entitlementForSubscription({
    email: 'buyer@example.com',
    plan: 'pro-monthly',
    customer: 'cus_1',
    periodEndSeconds: now + 60 * 86400,
  }),
  priv,
);
assert.equal(verifyEntitlement(token, pub, now + 45 * 86400).valid, true);
console.log('PASS: renewal token verifies past the original period end');

// 3. Cancellation → the old token simply expires at period end
assert.equal(verifyEntitlement(token, pub, now + 61 * 86400).reason, 'expired');
console.log('PASS: after the paid period the token reports expired');

// 4. Wrong key is rejected
const rogue = generateKeyPairSync('ed25519').privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
assert.equal(
  verifyEntitlement(
    signEntitlement(
      entitlementForSubscription({
        email: 'x@y.com',
        plan: 'p',
        customer: 'c',
        periodEndSeconds: now + 86400,
      }),
      rogue,
    ),
    pub,
    now,
  ).reason,
  'bad signature',
);
console.log('PASS: a token from a different signing key is rejected');
console.log('\nAll licensing lifecycle checks passed.');

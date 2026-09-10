import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { parseStripeEvent } from './webhook.mjs';

const secret = 'whsec_local_test_only';
const payload = JSON.stringify({
  id: 'evt_test',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_test' } },
});
const header = (options = {}) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret, ...options });

test('accepts a correctly signed raw event', () => {
  assert.equal(
    parseStripeEvent(Buffer.from(payload), header(), secret).id,
    'evt_test',
  );
});
test('rejects forged, missing, or wrong-secret signatures', () => {
  for (const signature of ['anything', undefined, header({ secret: 'wrong' })])
    assert.throws(() =>
      parseStripeEvent(Buffer.from(payload), signature, secret),
    );
});
test('rejects a modified body', () => {
  assert.throws(() =>
    parseStripeEvent(Buffer.from(payload + ' '), header(), secret),
  );
});
test('rejects an old signed delivery', () => {
  assert.throws(() =>
    parseStripeEvent(
      Buffer.from(payload),
      header({ timestamp: Math.floor(Date.now() / 1000) - 600 }),
      secret,
    ),
  );
});
test('rejects oversized bodies and missing configuration', () => {
  assert.throws(() =>
    parseStripeEvent(Buffer.alloc(1024 * 1024 + 1), header(), secret),
  );
  assert.throws(() =>
    parseStripeEvent(Buffer.from(payload), header(), undefined),
  );
});

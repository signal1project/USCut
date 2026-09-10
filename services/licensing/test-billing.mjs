import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentSubscription } from './billing.mjs';

test('uses current eligible subscription state and never invents paid time', async () => {
  let subscriptions = [];
  const stripe = {
    customers: { retrieve: async () => ({ email: 'Buyer@example.com' }) },
    subscriptions: {
      list: async function* () {
        yield* subscriptions;
      },
    },
  };
  const read = () =>
    currentSubscription(stripe, 'cus_test', new Set(['price_pro']), 1000);
  const active = {
    status: 'active',
    current_period_end: 2000,
    items: { data: [{ price: { id: 'price_pro' } }] },
  };
  subscriptions = [active];
  assert.equal((await read()).entitlement.periodEndSeconds, 2000);
  for (const candidate of [
    { ...active, status: 'canceled' },
    { ...active, status: 'past_due' },
    { ...active, pause_collection: {} },
    { ...active, current_period_end: undefined },
    { ...active, current_period_end: 900 },
    { ...active, items: { data: [{ price: { id: 'price_other' } }] } },
  ]) {
    subscriptions = [candidate];
    assert.equal((await read()).entitlement, null);
  }
  subscriptions = [{ ...active, cancel_at_period_end: true }];
  assert.equal((await read()).entitlement.periodEndSeconds, 2000);
  subscriptions = [];
  assert.equal((await read()).entitlement, null);
  stripe.customers.retrieve = async () => {
    throw new Error('offline');
  };
  await assert.rejects(read());
});

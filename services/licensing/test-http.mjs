import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import Stripe from 'stripe';
import { createLicensingServer } from './server.mjs';
import { verifyEntitlement } from './entitlement.mjs';

test('HTTP webhook issuance, authenticated activation, retry and cancellation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uscut-http-'));
  const keys = generateKeyPairSync('ed25519');
  let subscriptions = [
    {
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
      items: { data: [{ price: { id: 'price_pro' } }] },
    },
  ];
  let reads = 0;
  const server = await createLicensingServer({
    env: {
      LICENSE_STORE_PATH: path.join(dir, 'store.json'),
      LICENSE_SIGNING_KEY: keys.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_IDS: 'price_pro',
    },
    stripeClient: {
      customers: {
        retrieve: async () => {
          reads++;
          return { email: 'buyer@example.com' };
        },
      },
      subscriptions: {
        list: async function* () {
          yield* subscriptions;
        },
      },
    },
    authenticateIdentity: async (header) => {
      if (header !== 'Bearer test-identity') throw new Error('unauthorized');
      return { email: 'buyer@example.com' };
    },
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (endpoint, body, headers = {}) =>
      fetch(base + endpoint, { method: 'POST', body, headers });
    const webhook = (id, signature) => {
      const payload = JSON.stringify({
        id,
        type: 'customer.subscription.updated',
        data: { object: { customer: 'cus_test' } },
      });
      return send('/webhook', payload, {
        'stripe-signature':
          signature ||
          Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: 'whsec_test',
          }),
      });
    };
    assert.equal((await webhook('evt_forged', 'invalid')).status, 400);
    assert.equal(reads, 0);
    assert.equal((await webhook('evt_first')).status, 200);
    assert.equal(
      (await send('/activate', '{"email":"buyer@example.com"}')).status,
      401,
    );
    const activation = await send('/activate', '', {
      authorization: 'Bearer test-identity',
    });
    assert.equal(activation.status, 200);
    const { token } = await activation.json();
    assert.equal(
      verifyEntitlement(
        token,
        keys.publicKey.export({ type: 'spki', format: 'pem' }),
      ).valid,
      true,
    );
    await webhook('evt_first');
    assert.equal(reads, 1);
    subscriptions = [];
    assert.equal((await webhook('evt_cancel')).status, 200);
    assert.equal(
      (await send('/activate', '', { authorization: 'Bearer test-identity' }))
        .status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

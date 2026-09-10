// USCut licensing service — SCAFFOLD. Not connected to Stripe. See README.md.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { currentSubscription } from './billing.mjs';
import { openStore } from './store.mjs';
import { createAuthenticator } from './auth.mjs';
import { parseStripeEvent } from './webhook.mjs';
import { entitlementForSubscription, signEntitlement } from './entitlement.mjs';

export async function createLicensingServer({
  env = process.env,
  stripeClient,
  authenticateIdentity,
} = {}) {
  const SIGNING_KEY = env.LICENSE_SIGNING_KEY;
  const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
  const stripe =
    stripeClient ||
    (env.STRIPE_SECRET_KEY
      ? new Stripe(env.STRIPE_SECRET_KEY, {
          timeout: 15000,
          maxNetworkRetries: 2,
        })
      : null);
  const allowedPrices = new Set(
    (env.STRIPE_PRICE_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (!SIGNING_KEY)
    console.warn(
      'LICENSE_SIGNING_KEY is not set — /webhook and /activate will 503.',
    );

  if (!env.LICENSE_STORE_PATH)
    throw new Error('Set LICENSE_STORE_PATH to a persistent storage file');
  const entitlements = await openStore(env.LICENSE_STORE_PATH);
  const authenticate =
    authenticateIdentity ||
    (env.AUTH_ISSUER && env.AUTH_AUDIENCE && env.AUTH_JWKS_URL
      ? createAuthenticator({
          issuer: env.AUTH_ISSUER,
          audience: env.AUTH_AUDIENCE,
          jwksUrl: env.AUTH_JWKS_URL,
        })
      : null);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      req.on('data', (c) => {
        bytes += c.length;
        if (bytes > 1024 * 1024) {
          reject(
            Object.assign(new Error('Request body too large'), { status: 413 }),
          );
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function json(res, code, body) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function issue(store, { email, plan, customer, periodEndSeconds }) {
    if (!SIGNING_KEY) throw new Error('signing key unavailable');
    const claims = entitlementForSubscription({
      email,
      plan,
      customer,
      periodEndSeconds,
    });
    const token = signEntitlement(claims, SIGNING_KEY);
    store.set(claims.sub, { token, plan, customer, exp: claims.exp });
    return token;
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health')
        return json(res, 200, { ok: true, issued: entitlements.size });

      if (req.method === 'POST' && req.url === '/webhook') {
        const raw = await readBody(req);
        if (!STRIPE_WEBHOOK_SECRET)
          return json(res, 503, { error: 'Billing is not configured' });
        let event;
        try {
          event = parseStripeEvent(
            raw,
            req.headers['stripe-signature'],
            STRIPE_WEBHOOK_SECRET,
          );
        } catch {
          return json(res, 400, { error: 'Invalid webhook' });
        }
        await entitlements.apply(event.id, async (store) => {
          if (
            [
              'checkout.session.completed',
              'checkout.session.async_payment_succeeded',
              'customer.subscription.created',
              'customer.subscription.updated',
              'customer.subscription.deleted',
              'invoice.paid',
              'invoice.payment_failed',
              'customer.updated',
              'customer.deleted',
            ].includes(event.type)
          ) {
            const object = event.data.object;
            const customerId =
              event.type === 'customer.updated' ||
              event.type === 'customer.deleted'
                ? object.id
                : typeof object.customer === 'string'
                  ? object.customer
                  : object.customer?.id;
            const current = await currentSubscription(
              stripe,
              customerId,
              allowedPrices,
            );
            store.deleteCustomer(customerId);
            if (current.entitlement) issue(store, current.entitlement);
          }
        });
        return json(res, 200, { received: true });
      }

      if (req.method === 'POST' && req.url === '/activate') {
        if (!authenticate)
          return json(res, 503, { error: 'Sign-in is not configured' });
        let identity;
        try {
          identity = await authenticate(req.headers.authorization);
        } catch {
          return json(res, 401, {
            error: 'Sign in with a verified email to activate',
          });
        }
        const found = entitlements.get(identity.email);
        if (!found || found.exp <= Math.floor(Date.now() / 1000))
          return json(res, 404, { error: 'no active subscription' });
        return json(res, 200, { token: found.token });
      }

      json(res, 404, { error: 'not found' });
    } catch (error) {
      json(res, error.status || 503, {
        error:
          error.status === 413
            ? 'Request body too large'
            : 'Service unavailable',
      });
    }
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = await createLicensingServer();
  server.listen(Number(process.env.PORT || 8791), () =>
    console.log(`USCut licensing service on :${server.address().port}`),
  );
}

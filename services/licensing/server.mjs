// USCut licensing service — SCAFFOLD. Not connected to Stripe. See README.md.
import { createServer } from 'node:http';
import { entitlementForSubscription, signEntitlement } from './entitlement.mjs';

const PORT = Number(process.env.PORT || 8791);
const SIGNING_KEY = process.env.LICENSE_SIGNING_KEY; // ed25519 PKCS8 PEM
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!SIGNING_KEY)
  console.warn('LICENSE_SIGNING_KEY is not set — /webhook and /activate will 503.');

// Replace with a real datastore. Keyed by lower-cased email.
/** @type {Map<string, {token: string, plan: string, exp: number}>} */
const entitlements = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Placeholder — swap for `stripe.webhooks.constructEvent(raw, sig, secret)`. */
function parseStripeEvent(raw, signature) {
  if (!STRIPE_WEBHOOK_SECRET)
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  if (!signature) throw new Error('missing Stripe-Signature');
  return JSON.parse(raw.toString('utf8'));
}

function issue({ email, plan, customer, periodEndSeconds }) {
  if (!SIGNING_KEY) throw new Error('signing key unavailable');
  const claims = entitlementForSubscription({
    email,
    plan,
    customer,
    periodEndSeconds,
  });
  const token = signEntitlement(claims, SIGNING_KEY);
  entitlements.set(claims.sub, { token, plan, exp: claims.exp });
  return token;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health')
      return json(res, 200, { ok: true, issued: entitlements.size });

    if (req.method === 'POST' && req.url === '/webhook') {
      const raw = await readBody(req);
      const event = parseStripeEvent(raw, req.headers['stripe-signature']);
      const sub = event?.data?.object ?? {};
      const email =
        sub.customer_email || sub.customer_details?.email || sub.metadata?.email;
      if (
        ['checkout.session.completed', 'customer.subscription.updated'].includes(
          event.type,
        )
      ) {
        issue({
          email,
          plan: sub.items?.data?.[0]?.price?.id || sub.metadata?.plan || 'pro',
          customer: sub.customer || 'cus_unknown',
          periodEndSeconds:
            sub.current_period_end ||
            Math.floor(Date.now() / 1000) + 31 * 86400,
        });
      } else if (event.type === 'customer.subscription.deleted' && email) {
        entitlements.delete(String(email).toLowerCase());
      }
      return json(res, 200, { received: true });
    }

    if (req.method === 'POST' && req.url === '/activate') {
      const { email } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const found = entitlements.get(String(email || '').toLowerCase());
      if (!found) return json(res, 404, { error: 'no active subscription' });
      return json(res, 200, { token: found.token });
    }

    json(res, 404, { error: 'not found' });
  } catch (error) {
    json(res, 503, { error: error.message });
  }
});

server.listen(PORT, () =>
  console.log(`USCut licensing scaffold on :${PORT} (not production-ready)`),
);

import Stripe from 'stripe';

// Signature verification is local; it does not require an API key or a network call.
export function parseStripeEvent(raw, signature, secret) {
  if (!secret) throw new Error('Stripe webhook secret is not configured');
  if (!Buffer.isBuffer(raw) || raw.length > 1024 * 1024)
    throw new Error('Invalid webhook body');
  const event = Stripe.webhooks.constructEvent(raw, signature, secret, 300);
  if (!event || typeof event.id !== 'string' || !event.id.startsWith('evt_') ||
      typeof event.type !== 'string' || !event.data?.object)
    throw new Error('Invalid Stripe event');
  return event;
}

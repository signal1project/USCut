# USCut licensing service

Issues and serves the signed **entitlement tokens** the USCut desktop app
verifies offline (see `commont/entitlement.ts` / `electron/main/licensing/`).

This is a **scaffold**. It implements the token format, the sign path, and the
HTTP surface. It is **not connected to Stripe or deployed** — that needs
material only Dale can provide (below).

## What Dale must supply before this goes live

| Item | Where it goes | Notes |
|---|---|---|
| Stripe account + product/price ids | `STRIPE_*` env | test-mode first |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | env only | never in the app or repo |
| ed25519 **private** key | `LICENSE_SIGNING_KEY` env | pair of the public key bundled in `electron/main/licensing/entitlement.ts`; generated 2026-09-09, stored at `projects/_secrets/uscut-license.private.pem` (outside the repo) |
| Datastore | replace the in-memory `Map` in `server.mjs` | entitlements keyed by lower-cased email |
| Seller identity + support email | Stripe dashboard + app "About" | required for checkout |
| Hosting | any Node host | one small always-on process + a Stripe webhook endpoint |
| Code-signing certificate | electron-builder, separate | not this service, but a release blocker |

## Token format

`base64url(JSON claims) . base64url(ed25519 signature over the first part)`

Claims: `{ sub: email, product: "uscut", plan, customer, iat, exp, jti }`.
`exp` is the subscription's current period end. The app treats a token as
valid until `exp`, then keeps premium features for `OFFLINE_GRACE_DAYS` more
while it tries to refresh.

## Endpoints

- `POST /webhook` — Stripe events. On `checkout.session.completed` and
  `customer.subscription.updated`, (re)issue an entitlement for the customer's
  email with `exp = current_period_end`. On `customer.subscription.deleted`,
  drop it.
- `POST /activate` `{ email, key }` — returns `{ token }` for the current
  entitlement. `key` is a per-customer claim code emailed at checkout (wire it
  to Stripe customer metadata).
- `GET /health`

## Lifecycle test

`node test-lifecycle.mjs` signs a subscription entitlement with a throwaway
key and verifies it round-trips, then simulates renew and cancel. It does not
touch Stripe. The authoritative crypto-contract test is
`electron/main/licensing/__tests__/entitlement.test.ts` in the app repo.

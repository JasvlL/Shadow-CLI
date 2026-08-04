# Shadow licence API

A Cloudflare Worker over D1. It mints a licence when Paddle says someone paid, and
answers the CLI when it asks whether a key is good.

Deployed at `https://shadow-api.jeferson-zelayae.workers.dev` — which is also the default
baked into `packages/core/src/billing.ts`. Override with `SHADOW_API_URL` when developing.

## Endpoints

| Route | Who calls it |
|---|---|
| `POST /api/validate-license` | The CLI, on `/login shadow <key>` |
| `POST /api/webhook/paddle` | Paddle, on subscription events |
| `GET /api/license-by-subscription/:id` | The post-checkout page, to show the new key |

## Deploying

```bash
npx wrangler d1 execute shadow_licenses --remote --file=./schema.sql   # idempotent
npx wrangler secret put PADDLE_WEBHOOK_SECRET
npx wrangler deploy
```

`schema.sql` is safe to re-run: every statement is `IF NOT EXISTS`, so it will not drop
live licences.

## Connecting Paddle

1. Create the product and price in Paddle.
2. Add a notification destination pointing at
   `https://shadow-api.jeferson-zelayae.workers.dev/api/webhook/paddle`.
3. Subscribe it to `subscription.created`, `subscription.activated`,
   `subscription.updated`, `subscription.canceled`, `subscription.paused` and
   `subscription.past_due`.
4. Copy that destination's secret into `wrangler secret put PADDLE_WEBHOOK_SECRET`. Each
   destination has its own secret — using the wrong one fails every signature check.
5. Set `NEXT_PUBLIC_PADDLE_CHECKOUT_URL` in the Vercel project so the pricing page's
   button goes live. Until it is set, the button says "Checkout opening soon" rather
   than linking nowhere.

### Getting the key to the buyer

Paddle Billing does not issue licence keys, so this Worker generates one and stores it
against the subscription. The buyer still has to receive it — either send it from Paddle
using a webhook-driven email, or redirect checkout to a success page that reads
`GET /api/license-by-subscription/:id`. That endpoint treats the subscription id as a
bearer token: unguessable, but do not log it or store it anywhere durable.

## Security notes

- **Signature verification** covers replay too: the HMAC is over `<ts>:<raw body>` and a
  timestamp more than five minutes from now is rejected. The raw body text must be used —
  re-serialising parsed JSON changes bytes and breaks the signature.
- **Comparison is timing-safe.** A known CVE class in Paddle integrations is comparing
  signatures with `===`. Length is checked first, which is fine: a signature's length is
  not a secret, and Node's `timingSafeEqual` throws on a mismatch, turning a forgery into
  a 500 instead of a 401.
- **Webhooks are idempotent.** Paddle retries until it gets a 2xx, so `event_id` is
  recorded before any write and a repeat is a no-op instead of a second licence.
- **There is no test key.** Validation is the source of truth and fails closed. The CLI
  keeps a local `TEST-PRO-KEY` shortcut, but only under `SHADOW_DEV=1`, and the server
  never honours it.

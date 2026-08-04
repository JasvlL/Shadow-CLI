/**
 * The licence server.
 *
 * Two jobs: mint a licence when Paddle says someone paid, and answer the CLI when it
 * asks whether a key is good. This is the source of truth for PRO — the CLI caches the
 * answer locally but cannot manufacture one, so everything here fails closed.
 */

import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  /** Per-destination secret from Paddle → Developer Tools → Notifications. */
  PADDLE_WEBHOOK_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => c.text('Shadow API is running.'));

/* -------------------------------------------------------------------------- */
/* Licence validation — called by the CLI on `/login shadow <key>`             */
/* -------------------------------------------------------------------------- */

app.post('/api/validate-license', async (c) => {
  const body = await c.req.json<{ key?: string }>().catch(() => ({}) as { key?: string });
  const key = body.key;

  if (!key) {
    return c.json({ valid: false, error: 'License key is required' }, 400);
  }

  const license = await c.env.DB.prepare(
    'SELECT license_key, status, tier, expires_at FROM license_keys WHERE license_key = ?',
  )
    .bind(key)
    .first<{ status: string; tier: string; expires_at: string | null }>();

  if (!license) {
    return c.json({ valid: false, error: 'Invalid license key' }, 401);
  }

  if (license.status !== 'active') {
    return c.json({ valid: false, error: `License is ${license.status}` }, 401);
  }

  // A subscription that lapsed without us hearing the webhook must not stay valid.
  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return c.json({ valid: false, error: 'License has expired' }, 401);
  }

  return c.json({
    valid: true,
    tier: license.tier,
    status: license.status,
    expires_at: license.expires_at,
  });
});

/* -------------------------------------------------------------------------- */
/* Paddle webhook                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How far apart the signed timestamp and our clock may be.
 *
 * Paddle's own SDKs default to five seconds, which is tight enough that ordinary clock
 * skew between their sender and a Cloudflare edge node can reject a legitimate event.
 * Five minutes still makes a captured request useless long before it is worth replaying.
 */
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Compare in time independent of where the first difference falls.
 *
 * Length is checked first and returns early, which is safe: the length of a signature is
 * not a secret, and the alternative — Node's timingSafeEqual — throws on a mismatch,
 * turning a forged signature into a 500 instead of a 401.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Parse `ts=1671552777;h1=abc…` into its parts. */
function parsePaddleSignature(header: string): { ts: string; h1: string } | null {
  let ts = '';
  let h1 = '';
  for (const part of header.split(';')) {
    const [key, value] = part.split('=');
    if (key === 'ts' && value) ts = value;
    if (key === 'h1' && value) h1 = value;
  }
  return ts && h1 ? { ts, h1 } : null;
}

/**
 * Verify that Paddle really sent this body.
 *
 * The signed payload is `<ts>:<raw body>`, so the body has to be read as text exactly as
 * received — re-serialising parsed JSON changes the bytes and the signature stops
 * matching.
 */
async function verifyPaddleSignature(
  header: string,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return false;

  const timestampMs = Number(parsed.ts) * 1000;
  if (!Number.isFinite(timestampMs)) return false;
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_TOLERANCE_MS) return false;

  const expected = hexToBytes(parsed.h1);
  if (!expected) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parsed.ts}:${rawBody}`),
  );

  return timingSafeEqual(new Uint8Array(mac), expected);
}

interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  data?: {
    id?: string;
    status?: string;
    customer_id?: string;
    current_billing_period?: { ends_at?: string };
    custom_data?: Record<string, unknown> | null;
  };
}

function newLicenseKey(): string {
  return `SHADOW-PRO-${crypto.randomUUID().toUpperCase()}`;
}

app.post('/api/webhook/paddle', async (c) => {
  const signature = c.req.header('Paddle-Signature');
  const secret = c.env.PADDLE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return c.text('Missing signature or secret', 401);
  }

  const rawBody = await c.req.text();
  if (!(await verifyPaddleSignature(signature, rawBody, secret))) {
    return c.text('Invalid signature', 401);
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return c.text('Malformed body', 400);
  }

  const subscriptionId = event.data?.id;
  if (!event.event_type || !subscriptionId) {
    return c.text('OK');
  }

  // Paddle retries until it gets a 2xx, so the same event can arrive more than once.
  // Recording the id first means a retry is a no-op rather than a second licence.
  if (event.event_id) {
    const seen = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO webhook_events (event_id, event_type) VALUES (?, ?)',
    )
      .bind(event.event_id, event.event_type)
      .run();
    if (seen.meta.changes === 0) return c.text('OK (duplicate)');
  }

  const expiresAt = event.data?.current_billing_period?.ends_at ?? null;
  // Paddle only sends customer_id on subscription events; an email is here only when the
  // checkout was configured to pass one through.
  const email =
    typeof event.data?.custom_data?.email === 'string' ? event.data.custom_data.email : null;

  switch (event.event_type) {
    case 'subscription.created':
    case 'subscription.activated': {
      // Keyed on the subscription so a retry or a later reactivation updates the same
      // row instead of minting a second key for one customer.
      await c.env.DB.prepare(
        `INSERT INTO license_keys
           (id, license_key, status, tier, customer_email, customer_id, subscription_id, expires_at)
         VALUES (?, ?, 'active', 'pro', ?, ?, ?, ?)
         ON CONFLICT(subscription_id) DO UPDATE SET
           status = 'active',
           expires_at = excluded.expires_at`,
      )
        .bind(
          subscriptionId,
          newLicenseKey(),
          email,
          event.data?.customer_id ?? null,
          subscriptionId,
          expiresAt,
        )
        .run();
      break;
    }

    case 'subscription.updated': {
      // Carries the renewed period, which is what keeps a live subscription from
      // tripping the expiry check in validate-license.
      await c.env.DB.prepare(
        `UPDATE license_keys
            SET status = ?, expires_at = ?
          WHERE subscription_id = ?`,
      )
        .bind(event.data?.status === 'active' ? 'active' : 'inactive', expiresAt, subscriptionId)
        .run();
      break;
    }

    case 'subscription.canceled':
    case 'subscription.paused':
    case 'subscription.past_due': {
      await c.env.DB.prepare(
        `UPDATE license_keys SET status = 'expired' WHERE subscription_id = ?`,
      )
        .bind(subscriptionId)
        .run();
      break;
    }

    default:
      break;
  }

  return c.text('OK');
});

/* -------------------------------------------------------------------------- */
/* Key retrieval for the post-checkout page                                   */
/* -------------------------------------------------------------------------- */

/**
 * Look up the key minted for a subscription, so the success page can show it.
 *
 * The subscription id is the only credential here. That is the same shape as a Stripe
 * checkout-session lookup: the id is unguessable and short-lived in the user's URL, but
 * it is a bearer token — do not log it or put it anywhere durable.
 */
app.get('/api/license-by-subscription/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT license_key, status FROM license_keys WHERE subscription_id = ?',
  )
    .bind(c.req.param('id'))
    .first<{ license_key: string; status: string }>();

  if (!row || row.status !== 'active') {
    // Paddle redirects the buyer before the webhook necessarily lands, so "not yet" is
    // an expected answer the page should poll through rather than an error.
    return c.json({ ready: false }, 404);
  }

  return c.json({ ready: true, license_key: row.license_key });
});

export default app;

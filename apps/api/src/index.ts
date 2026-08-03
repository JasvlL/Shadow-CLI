import { Hono } from 'hono';
import crypto from 'node:crypto';

type Bindings = {
  DB: D1Database;
  LEMON_SQUEEZY_WEBHOOK_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => c.text('Shadow IDE API is running.'));

// 1. Endpoint to validate a license key from the CLI
app.post('/api/validate-license', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { key } = body;
  
  if (!key) {
    return c.json({ valid: false, error: 'License key is required' }, 400);
  }

  // Hardcoded fallback/test key
  if (key === 'TEST-PRO-KEY') {
    return c.json({ valid: true, tier: 'pro', status: 'active', expires_at: null });
  }

  // Validate against Cloudflare D1
  const license = await c.env.DB.prepare('SELECT * FROM license_keys WHERE license_key = ?')
    .bind(key)
    .first();

  if (!license) {
    return c.json({ valid: false, error: 'Invalid license key' }, 401);
  }

  if (license.status !== 'active') {
    return c.json({ valid: false, error: `License is ${license.status}` }, 401);
  }

  return c.json({
    valid: true,
    tier: license.tier,
    status: license.status,
    expires_at: license.expires_at
  });
});

// 2. Webhook to receive Lemon Squeezy events (subscriptions, payments)
app.post('/api/webhook/lemon-squeezy', async (c) => {
  const signature = c.req.header('x-signature');
  const secret = c.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return c.text('Missing signature or secret', 401);
  }

  const payload = await c.req.text();
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from(hmac.update(payload).digest('hex'), 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  if (!crypto.timingSafeEqual(digest, signatureBuffer)) {
    return c.text('Invalid signature', 401);
  }

  const event = JSON.parse(payload);
  const eventName = event.meta.event_name;
  const obj = event.data.attributes;

  if (eventName === 'subscription_created') {
    // Generar una llave aleatoria
    const newKey = 'SHADOW-PRO-' + crypto.randomUUID().toUpperCase();
    
    await c.env.DB.prepare(
      'INSERT INTO license_keys (id, license_key, status, tier, customer_email, subscription_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(event.data.id, newKey, 'active', 'pro', obj.user_email, obj.subscription_id?.toString() || '')
    .run();
    
    // Aquí podrías despachar un email con la llave (opcional, Lemon Squeezy también puede enviarla)
  } 
  else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
    await c.env.DB.prepare(
      "UPDATE license_keys SET status = 'expired' WHERE customer_email = ?"
    )
    .bind(obj.user_email)
    .run();
  }

  return c.text('OK');
});

export default app;

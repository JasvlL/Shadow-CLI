-- Shadow licence store.
--
-- Safe to re-run: every statement is guarded, so applying this to a live database does
-- not drop anyone's licence. (An earlier revision led with DROP TABLE, which would have.)

CREATE TABLE IF NOT EXISTS license_keys (
  id TEXT PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  -- 'active' | 'expired' | 'inactive'
  status TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'pro',
  customer_email TEXT,
  customer_id TEXT,
  -- UNIQUE so the webhook can upsert on it: a retry or a reactivation has to update the
  -- existing licence rather than mint a second key for the same subscription.
  subscription_id TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- End of the paid period. NULL means no expiry is known.
  expires_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_license_key ON license_keys (license_key);
CREATE INDEX IF NOT EXISTS idx_subscription_id ON license_keys (subscription_id);

-- Paddle retries a webhook until it sees a 2xx, so the same event id can arrive several
-- times. Recording it makes replays a no-op.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

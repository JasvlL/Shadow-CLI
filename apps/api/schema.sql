DROP TABLE IF EXISTS license_keys;

CREATE TABLE license_keys (
  id TEXT PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL, -- 'active', 'expired', 'cancelled'
  tier TEXT NOT NULL DEFAULT 'pro',
  customer_email TEXT,
  subscription_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

CREATE INDEX idx_license_key ON license_keys (license_key);

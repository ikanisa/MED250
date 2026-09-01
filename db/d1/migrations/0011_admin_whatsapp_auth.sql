-- Browser-admin authentication is intentionally separate from client and
-- pharmacy identities. This keeps privileged roles out of marketplace actor
-- constraints and makes every admin session independently revocable.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_admin_principals (
  id TEXT PRIMARY KEY,
  e164 TEXT NOT NULL UNIQUE CHECK (length(e164) BETWEEN 8 AND 15),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 2 AND 120),
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'operations_admin', 'catalogue_reviewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  otp_auth_enabled INTEGER NOT NULL DEFAULT 1 CHECK (otp_auth_enabled IN (0, 1)),
  created_by_label TEXT NOT NULL CHECK (length(trim(created_by_label)) BETWEEN 2 AND 160),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_admin_principals_status_idx
  ON med250_admin_principals (status, role, updated_at);

CREATE TABLE med250_admin_sessions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES med250_admin_principals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  csrf_hash TEXT NOT NULL CHECK (length(csrf_hash) = 64),
  request_ip_hash TEXT CHECK (request_ip_hash IS NULL OR length(request_ip_hash) = 64),
  user_agent_hash TEXT CHECK (user_agent_hash IS NULL OR length(user_agent_hash) = 64),
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (expires_at > created_at AND absolute_expires_at >= expires_at)
) STRICT;
CREATE INDEX med250_admin_sessions_principal_active_idx
  ON med250_admin_sessions (principal_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE med250_admin_otp_challenges (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES med250_admin_principals(id) ON DELETE CASCADE,
  e164 TEXT NOT NULL CHECK (length(e164) BETWEEN 8 AND 15),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  request_ip_hash TEXT NOT NULL CHECK (length(request_ip_hash) = 64),
  encrypted_code TEXT NOT NULL,
  encryption_nonce TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 8),
  delivery_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  provider_message_sid TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (attempts <= max_attempts)
) STRICT;
CREATE INDEX med250_admin_otp_challenges_active_idx
  ON med250_admin_otp_challenges (e164, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE med250_admin_otp_redemptions (
  challenge_id TEXT PRIMARY KEY REFERENCES med250_admin_otp_challenges(id) ON DELETE RESTRICT,
  principal_id TEXT NOT NULL REFERENCES med250_admin_principals(id) ON DELETE RESTRICT,
  redeemed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER med250_admin_otp_redemptions_no_update
BEFORE UPDATE ON med250_admin_otp_redemptions
BEGIN SELECT RAISE(ABORT, 'med250_admin_otp_redemptions is append-only'); END;
CREATE TRIGGER med250_admin_otp_redemptions_no_delete
BEFORE DELETE ON med250_admin_otp_redemptions
BEGIN SELECT RAISE(ABORT, 'med250_admin_otp_redemptions is append-only'); END;

CREATE TABLE med250_admin_auth_rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type = 'unknown_admin_login'),
  e164_hash TEXT NOT NULL CHECK (length(e164_hash) = 64),
  request_ip_hash TEXT NOT NULL CHECK (length(request_ip_hash) = 64),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_admin_auth_rate_events_phone_idx
  ON med250_admin_auth_rate_events (e164_hash, created_at);
CREATE INDEX med250_admin_auth_rate_events_source_idx
  ON med250_admin_auth_rate_events (request_ip_hash, created_at);

ALTER TABLE med250_dispatch_outbox
  ADD COLUMN admin_otp_challenge_id TEXT
  REFERENCES med250_admin_otp_challenges(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX med250_dispatch_outbox_admin_otp_idx
  ON med250_dispatch_outbox (admin_otp_challenge_id)
  WHERE admin_otp_challenge_id IS NOT NULL;

UPDATE med250_runtime_contract
SET expected_migration = '0011_admin_whatsapp_auth',
    expected_applied_count = 11,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

PRAGMA defer_foreign_keys = off;

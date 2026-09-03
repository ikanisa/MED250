-- Additive WhatsApp conversation, consent and provider-readiness records.
-- Existing telephone verification is deliberately NOT backfilled as messaging opt-in.
ALTER TABLE med250_actors ADD COLUMN whatsapp_opted_out_at TEXT;
ALTER TABLE med250_pharmacy_contacts ADD COLUMN messaging_opt_in_at TEXT;
ALTER TABLE med250_pharmacy_contacts ADD COLUMN messaging_opt_in_source TEXT;
ALTER TABLE med250_client_requests ADD COLUMN sealed_at TEXT;
ALTER TABLE med250_client_requests ADD COLUMN dispatch_consented_at TEXT;
ALTER TABLE med250_client_requests ADD COLUMN privacy_notice_version TEXT;

CREATE TABLE med250_whatsapp_drafts (
  actor_id TEXT PRIMARY KEY REFERENCES med250_actors(id),
  request_id TEXT NOT NULL UNIQUE REFERENCES med250_client_requests(id),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_twilio_content_registry (
  definition_key TEXT PRIMARY KEY,
  content_sid TEXT,
  definition_hash TEXT,
  state TEXT NOT NULL DEFAULT 'missing',
  lease_token TEXT,
  lease_expires_at TEXT,
  approval_status TEXT,
  rejection_reason TEXT,
  checked_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_whatsapp_permissions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES med250_actors(id),
  request_id TEXT REFERENCES med250_client_requests(id),
  event_id TEXT NOT NULL REFERENCES med250_inbound_events(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('request_disclosure', 'saved_location', 'pharmacy_notifications', 'client_notifications', 'opt_out')),
  notice_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(event_id, purpose)
) STRICT;

CREATE INDEX med250_whatsapp_permissions_actor_idx ON med250_whatsapp_permissions(actor_id, purpose, created_at);

-- Signed callbacks may precede the Messages API response. Keep a durable receipt
-- without patient content, then reconcile it once the SID is bound to an outbox.
CREATE TABLE med250_pending_delivery_callbacks (
  event_key TEXT PRIMARY KEY,
  message_sid TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  error_code TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_pending_callbacks_sid_idx ON med250_pending_delivery_callbacks(message_sid);

UPDATE med250_runtime_contract SET expected_migration = '0012_whatsapp_conversation_reliability',
  expected_applied_count = 12, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

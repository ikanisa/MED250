-- MED250 Cloudflare-only relational schema.
-- D1 uses SQLite semantics: ISO-8601 TEXT timestamps, INTEGER booleans,
-- JSON stored as validated TEXT, and private media bytes stored only in R2.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_pharmacies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 180),
  latitude REAL,
  longitude REAL,
  licence_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (licence_status IN ('pending', 'current', 'suspended', 'expired', 'revoked')),
  licence_expires_on TEXT,
  licence_number TEXT,
  address TEXT,
  google_maps_url TEXT,
  momo_code TEXT,
  marketplace_approved INTEGER NOT NULL DEFAULT 0 CHECK (marketplace_approved IN (0, 1)),
  dispatch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_enabled IN (0, 1)),
  registry_entry_key TEXT,
  registry_type TEXT CHECK (registry_type IS NULL OR registry_type IN ('retail', 'online')),
  fda_source_serial INTEGER CHECK (fda_source_serial IS NULL OR fda_source_serial > 0),
  responsible_professional TEXT,
  responsible_professional_registration TEXT,
  province TEXT,
  district TEXT,
  sector_cell_raw TEXT,
  source_name TEXT,
  source_url TEXT,
  geocode_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (geocode_status IN ('pending', 'candidate', 'verified', 'rejected')),
  geocode_provider TEXT CHECK (
    geocode_provider IS NULL OR geocode_provider IN ('google_places', 'government_gis', 'governed_registry_import')
  ),
  geocode_reference TEXT,
  geocode_formatted_address TEXT,
  geocode_confidence REAL CHECK (geocode_confidence IS NULL OR geocode_confidence BETWEEN 0 AND 1),
  geocode_checked_at TEXT,
  geocode_reviewed_by TEXT,
  geocode_reviewed_at TEXT,
  geocode_review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -3.0 AND -0.8 AND longitude BETWEEN 28.7 AND 30.9)
  ),
  CHECK (dispatch_enabled = 0 OR geocode_status = 'verified')
) STRICT;

CREATE UNIQUE INDEX med250_pharmacies_registry_entry_key_idx
  ON med250_pharmacies (registry_entry_key) WHERE registry_entry_key IS NOT NULL;
CREATE UNIQUE INDEX med250_pharmacies_registry_serial_idx
  ON med250_pharmacies (registry_type, fda_source_serial)
  WHERE registry_type IS NOT NULL AND fda_source_serial IS NOT NULL;
CREATE INDEX med250_pharmacies_dispatch_idx
  ON med250_pharmacies (dispatch_enabled, marketplace_approved, licence_status, licence_expires_on)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX med250_pharmacies_geocode_review_idx
  ON med250_pharmacies (geocode_status, fda_source_serial, id);

CREATE TABLE med250_pharmacy_contacts (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'phone', 'email')),
  e164 TEXT,
  address TEXT,
  verified_at TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  source_reference TEXT,
  source_observed_at TEXT,
  login_enabled INTEGER NOT NULL DEFAULT 0 CHECK (login_enabled IN (0, 1)),
  dispatch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_enabled IN (0, 1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (channel IN ('whatsapp', 'phone') AND e164 IS NOT NULL AND length(e164) BETWEEN 8 AND 15 AND address IS NULL)
    OR (channel = 'email' AND e164 IS NULL AND address IS NOT NULL)
  ),
  CHECK (
    (login_enabled = 0 AND dispatch_enabled = 0)
    OR (channel = 'whatsapp' AND verified_at IS NOT NULL AND active = 1)
  )
) STRICT;

CREATE UNIQUE INDEX med250_pharmacy_contacts_verified_whatsapp_idx
  ON med250_pharmacy_contacts (e164)
  WHERE channel = 'whatsapp' AND verified_at IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX med250_pharmacy_contacts_channel_e164_idx
  ON med250_pharmacy_contacts (pharmacy_id, channel, e164) WHERE e164 IS NOT NULL;
CREATE UNIQUE INDEX med250_pharmacy_contacts_primary_idx
  ON med250_pharmacy_contacts (pharmacy_id, channel) WHERE is_primary = 1 AND active = 1;
CREATE INDEX med250_pharmacy_contacts_pharmacy_idx
  ON med250_pharmacy_contacts (pharmacy_id, channel, active);

CREATE TABLE med250_known_pharmacy_numbers (
  e164 TEXT PRIMARY KEY CHECK (length(e164) BETWEEN 8 AND 15),
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('resolved', 'ambiguous', 'retired')),
  pharmacy_id TEXT REFERENCES med250_pharmacies(id) ON DELETE RESTRICT,
  source TEXT NOT NULL,
  source_evidence TEXT NOT NULL CHECK (json_valid(source_evidence) AND json_type(source_evidence) = 'object'),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (resolution_status = 'resolved' AND pharmacy_id IS NOT NULL)
    OR (resolution_status IN ('ambiguous', 'retired') AND pharmacy_id IS NULL)
  )
) STRICT;
CREATE INDEX med250_known_pharmacy_numbers_pharmacy_idx
  ON med250_known_pharmacy_numbers (pharmacy_id) WHERE pharmacy_id IS NOT NULL;

CREATE TABLE med250_actors (
  id TEXT PRIMARY KEY,
  e164 TEXT NOT NULL UNIQUE CHECK (length(e164) BETWEEN 8 AND 15),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('pharmacy', 'client')),
  pharmacy_id TEXT REFERENCES med250_pharmacies(id) ON DELETE SET NULL,
  profile_name TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  inbound_message_count INTEGER NOT NULL DEFAULT 0 CHECK (inbound_message_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (actor_type = 'pharmacy' OR pharmacy_id IS NULL)
) STRICT;
CREATE INDEX med250_actors_pharmacy_idx
  ON med250_actors (pharmacy_id) WHERE pharmacy_id IS NOT NULL;

CREATE TABLE med250_web_principals (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('client', 'pharmacy')),
  actor_id TEXT REFERENCES med250_actors(id) ON DELETE RESTRICT,
  verified_at TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK (subject_type = 'client' OR actor_id IS NOT NULL),
  CHECK ((actor_id IS NULL AND verified_at IS NULL) OR (actor_id IS NOT NULL AND verified_at IS NOT NULL))
) STRICT;
CREATE INDEX med250_web_principals_actor_idx
  ON med250_web_principals (actor_id) WHERE actor_id IS NOT NULL;

CREATE TABLE med250_web_sessions (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES med250_web_principals(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('client', 'pharmacy')),
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
CREATE INDEX med250_web_sessions_principal_active_idx
  ON med250_web_sessions (principal_id, scope, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE med250_otp_challenges (
  id TEXT PRIMARY KEY,
  principal_id TEXT REFERENCES med250_web_principals(id) ON DELETE CASCADE,
  e164 TEXT NOT NULL CHECK (length(e164) BETWEEN 8 AND 15),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('pharmacy', 'client')),
  purpose TEXT NOT NULL CHECK (purpose IN ('pharmacy_login', 'client_registration')),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  request_ip_hash TEXT CHECK (request_ip_hash IS NULL OR length(request_ip_hash) = 64),
  encrypted_code TEXT,
  encryption_nonce TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 8),
  delivery_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  provider_message_sid TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (attempts <= max_attempts),
  CHECK (
    (purpose = 'pharmacy_login' AND actor_type = 'pharmacy' AND principal_id IS NULL)
    OR (purpose = 'client_registration' AND actor_type = 'client' AND principal_id IS NOT NULL)
  )
) STRICT;
CREATE INDEX med250_otp_challenges_active_idx
  ON med250_otp_challenges (e164, actor_type, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE med250_web_auth_rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type = 'unknown_pharmacy_login'),
  e164_hash TEXT NOT NULL CHECK (length(e164_hash) = 64),
  request_ip_hash TEXT NOT NULL CHECK (length(request_ip_hash) = 64),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_web_auth_rate_events_phone_idx
  ON med250_web_auth_rate_events (e164_hash, created_at);
CREATE INDEX med250_web_auth_rate_events_source_idx
  ON med250_web_auth_rate_events (request_ip_hash, created_at);

CREATE TABLE med250_client_locations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES med250_actors(id) ON DELETE CASCADE,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -3.0 AND -0.8),
  longitude REAL NOT NULL CHECK (longitude BETWEEN 28.7 AND 30.9),
  accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m > 0 AND accuracy_m <= 5000),
  address TEXT,
  label TEXT,
  source TEXT NOT NULL CHECK (source IN ('whatsapp_native', 'secure_webview', 'web_order')),
  capture_key TEXT NOT NULL UNIQUE CHECK (length(capture_key) = 64),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  consented_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX med250_client_locations_current_idx
  ON med250_client_locations (actor_id) WHERE is_current = 1;
CREATE INDEX med250_client_locations_recent_idx
  ON med250_client_locations (actor_id, captured_at);

CREATE TABLE med250_web_prescription_media (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES med250_web_principals(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  processing_status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (processing_status IN ('uploading', 'ready', 'failed', 'deleted')),
  retention_expires_at TEXT NOT NULL,
  attached_request_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (processing_status = 'ready' AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND deleted_at IS NULL)
    OR processing_status <> 'ready'
  )
) STRICT;
CREATE INDEX med250_web_prescription_media_principal_idx
  ON med250_web_prescription_media (principal_id, created_at);
CREATE UNIQUE INDEX med250_web_prescription_media_attached_idx
  ON med250_web_prescription_media (attached_request_id) WHERE attached_request_id IS NOT NULL;

CREATE TABLE med250_client_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL REFERENCES med250_actors(id) ON DELETE RESTRICT,
  customer_e164 TEXT NOT NULL CHECK (length(customer_e164) BETWEEN 8 AND 15),
  source TEXT NOT NULL DEFAULT 'whatsapp_image' CHECK (source IN ('whatsapp_image', 'web_catalogue')),
  status TEXT NOT NULL DEFAULT 'awaiting_location' CHECK (status IN (
    'awaiting_location', 'awaiting_location_choice', 'processing_media', 'ready',
    'dispatched', 'selected', 'cancelled', 'expired', 'completed'
  )),
  location_id TEXT REFERENCES med250_client_locations(id) ON DELETE RESTRICT,
  dispatch_limit INTEGER NOT NULL DEFAULT 10 CHECK (dispatch_limit = 10),
  media_count INTEGER NOT NULL DEFAULT 0 CHECK (media_count BETWEEN 0 AND 10),
  web_principal_id TEXT REFERENCES med250_web_principals(id) ON DELETE RESTRICT,
  client_request_id TEXT,
  idempotency_hash TEXT CHECK (idempotency_hash IS NULL OR length(idempotency_hash) = 64),
  delivery_preference TEXT CHECK (delivery_preference IS NULL OR delivery_preference IN ('pickup', 'delivery', 'either')),
  substitutes_allowed INTEGER CHECK (substitutes_allowed IS NULL OR substitutes_allowed IN (0, 1)),
  location_accuracy_m REAL CHECK (location_accuracy_m IS NULL OR location_accuracy_m > 0 AND location_accuracy_m <= 5000),
  prescription_media_id TEXT REFERENCES med250_web_prescription_media(id) ON DELETE RESTRICT,
  selected_offer_id TEXT,
  selected_at TEXT,
  broadcast_at TEXT,
  expires_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source = 'whatsapp_image' AND web_principal_id IS NULL AND client_request_id IS NULL AND idempotency_hash IS NULL)
    OR (source = 'web_catalogue' AND web_principal_id IS NOT NULL AND client_request_id IS NOT NULL AND idempotency_hash IS NOT NULL)
  )
) STRICT;
CREATE INDEX med250_client_requests_actor_active_idx
  ON med250_client_requests (actor_id, created_at)
  WHERE status IN ('awaiting_location', 'awaiting_location_choice', 'processing_media', 'ready');
CREATE INDEX med250_client_requests_status_idx ON med250_client_requests (status, created_at);
CREATE UNIQUE INDEX med250_client_requests_web_idempotency_idx
  ON med250_client_requests (web_principal_id, client_request_id) WHERE source = 'web_catalogue';
CREATE INDEX med250_client_requests_web_principal_idx
  ON med250_client_requests (web_principal_id, created_at) WHERE source = 'web_catalogue';

CREATE TABLE med250_request_media (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  provider_message_sid TEXT NOT NULL,
  media_index INTEGER NOT NULL DEFAULT 0 CHECK (media_index BETWEEN 0 AND 9),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 16777216),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  r2_key TEXT UNIQUE,
  processing_status TEXT NOT NULL DEFAULT 'processing'
    CHECK (processing_status IN ('processing', 'ready', 'failed', 'deleted')),
  processing_error_code TEXT,
  retention_expires_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_message_sid, media_index),
  CHECK (
    (processing_status = 'ready' AND r2_key IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL)
    OR processing_status <> 'ready'
  )
) STRICT;
CREATE INDEX med250_request_media_request_idx
  ON med250_request_media (request_id, media_index, id);

CREATE TABLE med250_inbound_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio', 'meta')),
  provider_account_id TEXT NOT NULL,
  provider_message_sid TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES med250_actors(id) ON DELETE RESTRICT,
  request_id TEXT REFERENCES med250_client_requests(id) ON DELETE SET NULL,
  signature_verified INTEGER NOT NULL CHECK (signature_verified = 1),
  media_count INTEGER NOT NULL DEFAULT 0 CHECK (media_count BETWEEN 0 AND 10),
  location_provided INTEGER NOT NULL DEFAULT 0 CHECK (location_provided IN (0, 1)),
  button_payload TEXT,
  outcome TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (provider, provider_account_id, provider_message_sid)
) STRICT;
CREATE INDEX med250_inbound_events_actor_idx ON med250_inbound_events (actor_id, received_at);

CREATE TABLE med250_request_recipients (
  request_id TEXT NOT NULL REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE RESTRICT,
  recipient_e164 TEXT NOT NULL CHECK (length(recipient_e164) BETWEEN 8 AND 15),
  distance_m REAL NOT NULL CHECK (distance_m >= 0),
  response_status TEXT CHECK (response_status IS NULL OR response_status IN ('can_fulfil', 'cannot_fulfil')),
  dispatched_at TEXT NOT NULL,
  responded_at TEXT,
  PRIMARY KEY (request_id, pharmacy_id)
) STRICT;
CREATE INDEX med250_request_recipients_pharmacy_idx
  ON med250_request_recipients (pharmacy_id, dispatched_at);

CREATE TABLE med250_dispatch_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'client_media_request', 'web_catalogue_order', 'otp', 'offer',
    'location_capture', 'location_choice', 'client_confirmation', 'client_guidance'
  )),
  request_id TEXT REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  primary_media_id TEXT REFERENCES med250_request_media(id) ON DELETE RESTRICT,
  pharmacy_id TEXT REFERENCES med250_pharmacies(id) ON DELETE CASCADE,
  otp_challenge_id TEXT REFERENCES med250_otp_challenges(id) ON DELETE RESTRICT,
  recipient_e164 TEXT NOT NULL CHECK (length(recipient_e164) BETWEEN 8 AND 15),
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'claimed', 'enqueued', 'sending', 'sent', 'delivered', 'read',
    'retry', 'provider_send_unknown', 'failed', 'dead_letter'
  )),
  claim_token TEXT,
  claimed_at TEXT,
  claim_expires_at TEXT,
  queue_delivery_id TEXT UNIQUE,
  provider_attempts INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempts BETWEEN 0 AND 10),
  max_provider_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_provider_attempts BETWEEN 1 AND 10),
  available_at TEXT NOT NULL,
  provider_message_sid TEXT UNIQUE,
  last_error_code TEXT,
  send_started_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider_attempts <= max_provider_attempts)
) STRICT;
CREATE INDEX med250_dispatch_outbox_claim_idx
  ON med250_dispatch_outbox (available_at, created_at)
  WHERE status IN ('pending', 'retry', 'claimed');
CREATE INDEX med250_dispatch_outbox_request_idx ON med250_dispatch_outbox (request_id, created_at);
CREATE UNIQUE INDEX med250_dispatch_outbox_otp_idx
  ON med250_dispatch_outbox (otp_challenge_id) WHERE otp_challenge_id IS NOT NULL;

CREATE TABLE med250_media_access_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  outbox_id TEXT REFERENCES med250_dispatch_outbox(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'twilio_delivery' CHECK (purpose IN ('twilio_delivery', 'pharmacy_session')),
  allowed_fetches INTEGER NOT NULL DEFAULT 1 CHECK (allowed_fetches BETWEEN 1 AND 3),
  fetch_count INTEGER NOT NULL DEFAULT 0 CHECK (fetch_count >= 0),
  expires_at TEXT NOT NULL,
  last_fetched_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (fetch_count <= allowed_fetches),
  CHECK (
    (purpose = 'twilio_delivery' AND outbox_id IS NOT NULL AND request_id IS NULL)
    OR (purpose = 'pharmacy_session' AND outbox_id IS NULL AND request_id IS NOT NULL)
  )
) STRICT;
CREATE INDEX med250_media_access_grants_active_idx
  ON med250_media_access_grants (token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX med250_media_access_grants_request_idx
  ON med250_media_access_grants (request_id, pharmacy_id, expires_at)
  WHERE purpose = 'pharmacy_session';

CREATE TABLE med250_pharmacy_responses (
  id TEXT PRIMARY KEY,
  provider_message_sid TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE CASCADE,
  response_status TEXT NOT NULL CHECK (response_status IN ('can_fulfil', 'cannot_fulfil')),
  offer_id TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (request_id, pharmacy_id, provider_message_sid)
) STRICT;
CREATE INDEX med250_pharmacy_responses_request_idx
  ON med250_pharmacy_responses (request_id, received_at);

CREATE TABLE med250_provider_delivery_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('twilio', 'meta')),
  provider_event_key TEXT NOT NULL,
  outbox_id TEXT NOT NULL REFERENCES med250_dispatch_outbox(id) ON DELETE CASCADE,
  provider_message_sid TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  error_code TEXT,
  signature_verified INTEGER NOT NULL CHECK (signature_verified = 1),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_key)
) STRICT;
CREATE INDEX med250_provider_delivery_events_outbox_idx
  ON med250_provider_delivery_events (outbox_id, occurred_at);

CREATE TABLE med250_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES med250_actors(id) ON DELETE SET NULL,
  request_id TEXT REFERENCES med250_client_requests(id) ON DELETE SET NULL,
  outbox_id TEXT REFERENCES med250_dispatch_outbox(id) ON DELETE SET NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details) AND json_type(details) = 'object'),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_audit_events_request_idx ON med250_audit_events (request_id, created_at);
CREATE INDEX med250_audit_events_outbox_idx ON med250_audit_events (outbox_id, created_at);
CREATE TRIGGER med250_audit_events_no_update BEFORE UPDATE ON med250_audit_events
BEGIN SELECT RAISE(ABORT, 'med250_audit_events is append-only'); END;
CREATE TRIGGER med250_audit_events_no_delete BEFORE DELETE ON med250_audit_events
BEGIN SELECT RAISE(ABORT, 'med250_audit_events is append-only'); END;

PRAGMA defer_foreign_keys = off;

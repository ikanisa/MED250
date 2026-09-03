-- One explicitly scoped, owner-attested in-person permission per destination.
-- This is not recurring consent and never modifies messaging_opt_in_at.
CREATE TABLE med250_partner_location_permissions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL UNIQUE REFERENCES med250_pharmacy_contacts(id),
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id),
  e164 TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source='owner_attested_in_person'),
  owner_statement TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at>recorded_at),
  outbox_id TEXT UNIQUE REFERENCES med250_dispatch_outbox(id),
  revoked_at TEXT
) STRICT;

CREATE TRIGGER med250_partner_location_permission_immutable
BEFORE UPDATE ON med250_partner_location_permissions
WHEN OLD.id<>NEW.id OR OLD.campaign_id<>NEW.campaign_id OR OLD.contact_id<>NEW.contact_id
  OR OLD.pharmacy_id<>NEW.pharmacy_id OR OLD.e164<>NEW.e164 OR OLD.source<>NEW.source
  OR OLD.owner_statement<>NEW.owner_statement OR OLD.evidence_reference<>NEW.evidence_reference
  OR OLD.recorded_at<>NEW.recorded_at OR OLD.expires_at<>NEW.expires_at
  OR (OLD.outbox_id IS NOT NULL AND (NEW.outbox_id IS NULL OR OLD.outbox_id<>NEW.outbox_id))
  OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR OLD.revoked_at<>NEW.revoked_at))
BEGIN SELECT RAISE(ABORT,'partner_location_permission_immutable'); END;

CREATE TRIGGER med250_partner_location_stop
AFTER UPDATE OF whatsapp_opted_out_at ON med250_actors
WHEN NEW.whatsapp_opted_out_at IS NOT NULL
BEGIN
  UPDATE med250_partner_location_permissions SET revoked_at=coalesce(revoked_at,NEW.whatsapp_opted_out_at)
    WHERE e164=NEW.e164;
END;

CREATE TABLE med250_partner_location_submissions (
  id TEXT PRIMARY KEY,
  permission_id TEXT NOT NULL REFERENCES med250_partner_location_permissions(id),
  event_id TEXT NOT NULL UNIQUE REFERENCES med250_inbound_events(id),
  actor_id TEXT NOT NULL REFERENCES med250_actors(id),
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id),
  contact_id TEXT NOT NULL REFERENCES med250_pharmacy_contacts(id),
  e164 TEXT NOT NULL,
  latitude REAL NOT NULL CHECK(latitude BETWEEN -3 AND -0.8),
  longitude REAL NOT NULL CHECK(longitude BETWEEN 28.7 AND 30.9),
  address TEXT,
  label TEXT,
  source TEXT NOT NULL CHECK(source='signed_whatsapp_native'),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','verified','rejected')),
  received_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER med250_partner_location_submission_evidence_immutable
BEFORE UPDATE ON med250_partner_location_submissions
WHEN OLD.id<>NEW.id OR OLD.permission_id<>NEW.permission_id OR OLD.event_id<>NEW.event_id
  OR OLD.actor_id<>NEW.actor_id OR OLD.pharmacy_id<>NEW.pharmacy_id OR OLD.contact_id<>NEW.contact_id
  OR OLD.e164<>NEW.e164 OR OLD.latitude<>NEW.latitude OR OLD.longitude<>NEW.longitude
  OR OLD.address IS NOT NEW.address OR OLD.label IS NOT NEW.label
  OR OLD.source<>NEW.source OR OLD.received_at<>NEW.received_at
BEGIN SELECT RAISE(ABORT,'partner_location_evidence_immutable'); END;

UPDATE med250_runtime_contract SET expected_migration='0014_partner_location_outreach',
  expected_applied_count=14,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE contract_key='worker_runtime';

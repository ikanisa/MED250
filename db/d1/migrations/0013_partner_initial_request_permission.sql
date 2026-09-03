-- Owner-confirmed permission for one initial request is not recipient opt-in.
-- No phone verification, delivery receipt or availability reply grants recurring alerts.
CREATE TABLE med250_partner_permission_attestations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'owner_confirmation'),
  statement TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  scope_sha256 TEXT NOT NULL CHECK (length(scope_sha256) = 64),
  contact_count INTEGER NOT NULL CHECK (contact_count > 0)
) STRICT;

CREATE TABLE med250_partner_initial_permissions (
  contact_id TEXT PRIMARY KEY REFERENCES med250_pharmacy_contacts(id),
  attestation_id TEXT NOT NULL REFERENCES med250_partner_permission_attestations(id),
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id),
  e164 TEXT NOT NULL UNIQUE,
  recorded_at TEXT NOT NULL,
  claimed_request_id TEXT REFERENCES med250_client_requests(id),
  claimed_at TEXT,
  revoked_at TEXT,
  CHECK ((claimed_request_id IS NULL) = (claimed_at IS NULL))
) STRICT;

-- A grant covers the entire first request bundle, but cannot be reused for a
-- second request, including after a failed or uncertain provider send.
CREATE TRIGGER med250_partner_initial_claim_guard
BEFORE UPDATE OF claimed_request_id ON med250_partner_initial_permissions
WHEN NEW.claimed_request_id IS NOT NULL AND (
  (OLD.claimed_request_id IS NOT NULL AND OLD.claimed_request_id <> NEW.claimed_request_id)
  OR NEW.revoked_at IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM med250_pharmacy_contacts c JOIN med250_pharmacies p ON p.id=c.pharmacy_id
    JOIN med250_client_requests r ON r.id=NEW.claimed_request_id
    WHERE c.id=NEW.contact_id AND c.pharmacy_id=NEW.pharmacy_id AND c.e164=NEW.e164
      AND c.channel='whatsapp' AND c.active=1 AND c.dispatch_enabled=1 AND c.verified_at IS NOT NULL
      AND p.marketplace_approved=1 AND p.dispatch_enabled=1 AND p.geocode_status='verified'
      AND p.licence_status='current' AND p.licence_expires_on>=date('now')
      AND p.latitude BETWEEN -3 AND -0.8 AND p.longitude BETWEEN 28.7 AND 30.9
      AND r.status='ready' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND r.created_at>=NEW.recorded_at
      AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=c.e164 AND a.whatsapp_opted_out_at IS NOT NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'partner_initial_permission_changed');
END;

CREATE TRIGGER med250_partner_initial_claim_immutable
BEFORE UPDATE ON med250_partner_initial_permissions
WHEN OLD.contact_id<>NEW.contact_id OR OLD.attestation_id<>NEW.attestation_id
  OR OLD.pharmacy_id<>NEW.pharmacy_id OR OLD.e164<>NEW.e164 OR OLD.recorded_at<>NEW.recorded_at
  OR (OLD.claimed_request_id IS NOT NULL AND NEW.claimed_request_id IS NULL)
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'partner_initial_permission_immutable');
END;

UPDATE med250_runtime_contract SET expected_migration='0013_partner_initial_request_permission',
  expected_applied_count=13,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE contract_key='worker_runtime';

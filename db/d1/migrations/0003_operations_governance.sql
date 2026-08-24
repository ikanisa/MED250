-- Recovery receipts, private-media retention, operator review evidence, and
-- the Cloudflare D1 runtime contract.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_dashboard_recovery_imports (
  id TEXT PRIMARY KEY,
  source_project_ref TEXT NOT NULL CHECK (length(source_project_ref) = 20),
  exported_at TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL UNIQUE CHECK (length(source_snapshot_sha256) = 64),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  table_count INTEGER NOT NULL CHECK (table_count BETWEEN 1 AND 100),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 10000000),
  target TEXT NOT NULL CHECK (target IN ('staging', 'production')),
  imported_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_dashboard_recovery_files (
  import_id TEXT NOT NULL REFERENCES med250_dashboard_recovery_imports(id) ON DELETE RESTRICT,
  source_table TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 5 AND 180),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 1000000),
  headers TEXT NOT NULL CHECK (json_valid(headers) AND json_type(headers) = 'array'),
  PRIMARY KEY (import_id, source_table),
  UNIQUE (import_id, file_name)
) STRICT;

CREATE TABLE med250_dashboard_recovery_rows (
  import_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number >= 2),
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 500),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  imported_at TEXT NOT NULL,
  PRIMARY KEY (import_id, source_table, source_row_number),
  FOREIGN KEY (import_id, source_table)
    REFERENCES med250_dashboard_recovery_files(import_id, source_table) ON DELETE RESTRICT
) STRICT;
CREATE INDEX med250_dashboard_recovery_rows_source_key_idx
  ON med250_dashboard_recovery_rows (source_table, source_key);
CREATE INDEX med250_dashboard_recovery_rows_payload_sha_idx
  ON med250_dashboard_recovery_rows (payload_sha256);

CREATE TABLE med250_pharmacy_registry_import_receipts (
  id TEXT PRIMARY KEY,
  source_snapshot_sha256 TEXT NOT NULL UNIQUE CHECK (length(source_snapshot_sha256) = 64),
  source_manifest TEXT NOT NULL CHECK (json_valid(source_manifest)),
  pharmacy_count INTEGER NOT NULL CHECK (pharmacy_count >= 0),
  contact_count INTEGER NOT NULL CHECK (contact_count >= 0),
  known_number_count INTEGER NOT NULL CHECK (known_number_count >= 0),
  ambiguous_number_count INTEGER NOT NULL CHECK (ambiguous_number_count >= 0),
  dispatch_eligible_count INTEGER NOT NULL CHECK (dispatch_eligible_count >= 0),
  target TEXT NOT NULL CHECK (target IN ('staging', 'production')),
  imported_at TEXT NOT NULL,
  CHECK (ambiguous_number_count <= known_number_count AND dispatch_eligible_count <= pharmacy_count)
) STRICT;

CREATE TABLE med250_private_media_cleanup_jobs (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('whatsapp_request', 'web_prescription')),
  source_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE CHECK (length(r2_key) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'retry', 'deleted', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TEXT NOT NULL,
  claim_token TEXT,
  claimed_at TEXT,
  claim_expires_at TEXT,
  last_error_code TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_kind, source_id),
  CHECK (
    (status = 'claimed' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL)
    OR (status <> 'claimed' AND claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
  ),
  CHECK ((status = 'deleted' AND completed_at IS NOT NULL) OR (status <> 'deleted' AND completed_at IS NULL)),
  CHECK (attempt_count <= max_attempts)
) STRICT;
CREATE INDEX med250_private_media_cleanup_claim_idx
  ON med250_private_media_cleanup_jobs (available_at, created_at)
  WHERE status IN ('pending', 'retry', 'claimed');

CREATE TABLE med250_catalogue_product_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES med250_catalogue_products(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('start_review', 'compliance_review', 'approve', 'reject', 'unpublish')),
  reviewed_by TEXT NOT NULL CHECK (length(trim(reviewed_by)) BETWEEN 3 AND 200),
  evidence_note TEXT NOT NULL CHECK (length(trim(evidence_note)) BETWEEN 20 AND 4000),
  compliance_evidence_url TEXT,
  expected_product_updated_at TEXT NOT NULL,
  previous_state TEXT NOT NULL CHECK (json_valid(previous_state)),
  resulting_state TEXT NOT NULL CHECK (json_valid(resulting_state)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_catalogue_product_reviews_product_idx
  ON med250_catalogue_product_reviews (product_id, created_at);

CREATE TABLE med250_product_description_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES med250_catalogue_products(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'withdraw')),
  reviewed_description TEXT NOT NULL CHECK (length(reviewed_description) BETWEEN 40 AND 2000),
  source_name TEXT NOT NULL CHECK (length(trim(source_name)) BETWEEN 2 AND 160),
  source_url TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  rights_basis TEXT NOT NULL CHECK (length(trim(rights_basis)) BETWEEN 20 AND 500),
  rights_reference TEXT NOT NULL CHECK (length(trim(rights_reference)) BETWEEN 12 AND 500),
  rights_verified INTEGER NOT NULL CHECK (rights_verified = 1),
  clinical_review_status TEXT NOT NULL CHECK (clinical_review_status IN ('not_required', 'approved')),
  review_note TEXT NOT NULL CHECK (length(trim(review_note)) BETWEEN 20 AND 1000),
  reviewed_by TEXT NOT NULL CHECK (length(trim(reviewed_by)) BETWEEN 2 AND 160),
  reviewed_role TEXT NOT NULL CHECK (length(trim(reviewed_role)) BETWEEN 2 AND 160),
  reviewed_at TEXT NOT NULL,
  expected_product_updated_at TEXT NOT NULL,
  previous_state TEXT NOT NULL CHECK (json_valid(previous_state)),
  resulting_state TEXT NOT NULL CHECK (json_valid(resulting_state)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_product_description_reviews_product_idx
  ON med250_product_description_reviews (product_id, created_at);

CREATE TABLE med250_runtime_contract (
  contract_key TEXT PRIMARY KEY CHECK (contract_key = 'worker_runtime'),
  expected_migration TEXT NOT NULL,
  expected_applied_count INTEGER NOT NULL CHECK (expected_applied_count > 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_canonical_migration_manifest (
  version TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  recorded_at TEXT NOT NULL
) STRICT;

INSERT INTO med250_runtime_contract (
  contract_key, expected_migration, expected_applied_count, updated_at
) VALUES ('worker_runtime', '0003_operations_governance', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- All governed evidence ledgers are append-only. D1 enforces this at the
-- database layer in addition to the absence of mutation methods in the Worker.
CREATE TRIGGER med250_schema_migrations_no_update BEFORE UPDATE ON med250_schema_migrations
BEGIN SELECT RAISE(ABORT, 'med250_schema_migrations is append-only'); END;
CREATE TRIGGER med250_schema_migrations_no_delete BEFORE DELETE ON med250_schema_migrations
BEGIN SELECT RAISE(ABORT, 'med250_schema_migrations is append-only'); END;

CREATE TRIGGER med250_catalogue_import_receipts_no_update BEFORE UPDATE ON med250_catalogue_import_receipts
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_import_receipts is append-only'); END;
CREATE TRIGGER med250_catalogue_import_receipts_no_delete BEFORE DELETE ON med250_catalogue_import_receipts
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_import_receipts is append-only'); END;

CREATE TRIGGER med250_media_recovery_receipts_no_update BEFORE UPDATE ON med250_catalogue_media_recovery_receipts
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_media_recovery_receipts is append-only'); END;
CREATE TRIGGER med250_media_recovery_receipts_no_delete BEFORE DELETE ON med250_catalogue_media_recovery_receipts
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_media_recovery_receipts is append-only'); END;

CREATE TRIGGER med250_pharmacy_registry_receipts_no_update BEFORE UPDATE ON med250_pharmacy_registry_import_receipts
BEGIN SELECT RAISE(ABORT, 'med250_pharmacy_registry_import_receipts is append-only'); END;
CREATE TRIGGER med250_pharmacy_registry_receipts_no_delete BEFORE DELETE ON med250_pharmacy_registry_import_receipts
BEGIN SELECT RAISE(ABORT, 'med250_pharmacy_registry_import_receipts is append-only'); END;

CREATE TRIGGER med250_catalogue_price_contributions_no_update BEFORE UPDATE ON med250_catalogue_price_contributions
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_price_contributions is append-only'); END;
CREATE TRIGGER med250_catalogue_price_contributions_no_delete BEFORE DELETE ON med250_catalogue_price_contributions
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_price_contributions is append-only'); END;

CREATE TRIGGER med250_catalogue_product_reviews_no_update BEFORE UPDATE ON med250_catalogue_product_reviews
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_product_reviews is append-only'); END;
CREATE TRIGGER med250_catalogue_product_reviews_no_delete BEFORE DELETE ON med250_catalogue_product_reviews
BEGIN SELECT RAISE(ABORT, 'med250_catalogue_product_reviews is append-only'); END;

CREATE TRIGGER med250_product_description_reviews_no_update BEFORE UPDATE ON med250_product_description_reviews
BEGIN SELECT RAISE(ABORT, 'med250_product_description_reviews is append-only'); END;
CREATE TRIGGER med250_product_description_reviews_no_delete BEFORE DELETE ON med250_product_description_reviews
BEGIN SELECT RAISE(ABORT, 'med250_product_description_reviews is append-only'); END;

CREATE TRIGGER med250_canonical_manifest_no_update BEFORE UPDATE ON med250_canonical_migration_manifest
BEGIN SELECT RAISE(ABORT, 'med250_canonical_migration_manifest is append-only'); END;
CREATE TRIGGER med250_canonical_manifest_no_delete BEFORE DELETE ON med250_canonical_migration_manifest
BEGIN SELECT RAISE(ABORT, 'med250_canonical_migration_manifest is append-only'); END;

PRAGMA defer_foreign_keys = off;

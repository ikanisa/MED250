-- Bind every browser-dashboard recovery import to a deterministic plan and a
-- separate post-import readback receipt. Source rows and evidence are
-- append-only; transient Supabase sessions and OTP material are never copied.

CREATE TABLE med250_dashboard_recovery_plans (
  import_id TEXT PRIMARY KEY
    REFERENCES med250_dashboard_recovery_imports(id) ON DELETE RESTRICT,
  plan_sha256 TEXT NOT NULL UNIQUE CHECK (length(plan_sha256) = 64),
  expected_readback_counts TEXT NOT NULL
    CHECK (json_valid(expected_readback_counts) AND json_type(expected_readback_counts) = 'object'),
  source_table_counts TEXT NOT NULL
    CHECK (json_valid(source_table_counts) AND json_type(source_table_counts) = 'object'),
  canonical_table_counts TEXT NOT NULL
    CHECK (json_valid(canonical_table_counts) AND json_type(canonical_table_counts) = 'object'),
  raw_only_table_counts TEXT NOT NULL
    CHECK (json_valid(raw_only_table_counts) AND json_type(raw_only_table_counts) = 'object'),
  skipped_row_counts TEXT NOT NULL
    CHECK (json_valid(skipped_row_counts) AND json_type(skipped_row_counts) = 'object'),
  warning_counts TEXT NOT NULL
    CHECK (json_valid(warning_counts) AND json_type(warning_counts) = 'object'),
  prepared_at TEXT NOT NULL
) STRICT;

CREATE TABLE med250_dashboard_recovery_verifications (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL UNIQUE
    REFERENCES med250_dashboard_recovery_imports(id) ON DELETE RESTRICT,
  plan_sha256 TEXT NOT NULL
    REFERENCES med250_dashboard_recovery_plans(plan_sha256) ON DELETE RESTRICT,
  observed_counts TEXT NOT NULL
    CHECK (json_valid(observed_counts) AND json_type(observed_counts) = 'object'),
  target TEXT NOT NULL CHECK (target IN ('staging', 'production')),
  verified_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER med250_dashboard_recovery_imports_no_update
BEFORE UPDATE ON med250_dashboard_recovery_imports
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_imports is append-only'); END;
CREATE TRIGGER med250_dashboard_recovery_imports_no_delete
BEFORE DELETE ON med250_dashboard_recovery_imports
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_imports is append-only'); END;

CREATE TRIGGER med250_dashboard_recovery_files_no_update
BEFORE UPDATE ON med250_dashboard_recovery_files
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_files is append-only'); END;
CREATE TRIGGER med250_dashboard_recovery_files_no_delete
BEFORE DELETE ON med250_dashboard_recovery_files
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_files is append-only'); END;

CREATE TRIGGER med250_dashboard_recovery_rows_no_update
BEFORE UPDATE ON med250_dashboard_recovery_rows
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_rows is append-only'); END;
CREATE TRIGGER med250_dashboard_recovery_rows_no_delete
BEFORE DELETE ON med250_dashboard_recovery_rows
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_rows is append-only'); END;

CREATE TRIGGER med250_dashboard_recovery_plans_no_update
BEFORE UPDATE ON med250_dashboard_recovery_plans
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_plans is append-only'); END;
CREATE TRIGGER med250_dashboard_recovery_plans_no_delete
BEFORE DELETE ON med250_dashboard_recovery_plans
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_plans is append-only'); END;

CREATE TRIGGER med250_dashboard_recovery_verifications_no_update
BEFORE UPDATE ON med250_dashboard_recovery_verifications
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_verifications is append-only'); END;
CREATE TRIGGER med250_dashboard_recovery_verifications_no_delete
BEFORE DELETE ON med250_dashboard_recovery_verifications
BEGIN SELECT RAISE(ABORT, 'med250_dashboard_recovery_verifications is append-only'); END;

UPDATE med250_runtime_contract
SET expected_migration = '0008_dashboard_recovery_reconciliation',
    expected_applied_count = 8,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

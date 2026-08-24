-- Preserve bounded inbound failure evidence in D1 without logging client data.
ALTER TABLE med250_inbound_events ADD COLUMN last_error_code TEXT;

UPDATE med250_runtime_contract
SET expected_migration = '0006_inbound_failure_evidence',
    expected_applied_count = 6,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

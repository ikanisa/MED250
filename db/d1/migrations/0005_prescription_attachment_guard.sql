-- One private prescription object can authorize only one catalogue request.
CREATE UNIQUE INDEX med250_client_requests_prescription_once_idx
  ON med250_client_requests (prescription_media_id)
  WHERE prescription_media_id IS NOT NULL;

UPDATE med250_runtime_contract
SET expected_migration = '0005_prescription_attachment_guard',
    expected_applied_count = 5,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

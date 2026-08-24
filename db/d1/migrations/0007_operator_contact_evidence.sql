-- Keep named contact-review evidence on the resulting governed contacts.
ALTER TABLE med250_pharmacy_contacts ADD COLUMN verified_by_label TEXT;
ALTER TABLE med250_pharmacy_contacts ADD COLUMN verification_note TEXT;
ALTER TABLE med250_pharmacy_contacts ADD COLUMN derived_from_contact_id TEXT
  REFERENCES med250_pharmacy_contacts(id) ON DELETE SET NULL;

UPDATE med250_runtime_contract
SET expected_migration = '0007_operator_contact_evidence',
    expected_applied_count = 7,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

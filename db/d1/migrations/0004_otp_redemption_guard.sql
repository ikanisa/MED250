-- A unique redemption guard makes successful OTP consumption atomic under
-- concurrent Worker requests without relying on PostgreSQL advisory locks.

CREATE TABLE med250_otp_redemptions (
  challenge_id TEXT PRIMARY KEY REFERENCES med250_otp_challenges(id) ON DELETE RESTRICT,
  principal_id TEXT NOT NULL REFERENCES med250_web_principals(id) ON DELETE RESTRICT,
  redeemed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER med250_otp_redemptions_no_update BEFORE UPDATE ON med250_otp_redemptions
BEGIN SELECT RAISE(ABORT, 'med250_otp_redemptions is append-only'); END;
CREATE TRIGGER med250_otp_redemptions_no_delete BEFORE DELETE ON med250_otp_redemptions
BEGIN SELECT RAISE(ABORT, 'med250_otp_redemptions is append-only'); END;

UPDATE med250_runtime_contract
SET expected_migration = '0004_otp_redemption_guard',
    expected_applied_count = 4,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

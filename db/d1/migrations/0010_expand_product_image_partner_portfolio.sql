-- Register the broader MED+250 partner/copyright authorization confirmed by
-- the product owner without weakening the fail-closed rights gate. The
-- portfolio policy is scoped to the exact retained asset identity
-- (product/position/hash/source domain), so it cannot authorize an unknown
-- future image merely because it comes from a familiar marketplace.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_media_rights_policy_assets (
  policy_id TEXT NOT NULL REFERENCES med250_media_rights_policies(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 80),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64
    AND content_sha256 = lower(content_sha256)
  ),
  source_domain TEXT NOT NULL CHECK (
    source_domain = lower(source_domain)
    AND length(source_domain) BETWEEN 4 AND 253
    AND source_domain NOT LIKE '.%'
    AND source_domain NOT LIKE '%.'
    AND source_domain NOT LIKE '%/%'
    AND source_domain NOT LIKE '%:%'
  ),
  registered_by TEXT NOT NULL CHECK (length(trim(registered_by)) BETWEEN 3 AND 160),
  registered_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, product_id, position, content_sha256, source_domain)
) STRICT;

CREATE INDEX med250_media_rights_policy_assets_lookup_idx
  ON med250_media_rights_policy_assets (
    product_id, position, content_sha256, source_domain, policy_id
  );

INSERT INTO med250_media_rights_policies (
  id, source_name, authorization_kind, evidence_reference, permitted_use,
  domain_scope_required, status, effective_at, expires_at,
  confirmed_by, confirmed_at, created_at, updated_at
) VALUES (
  'partner-portfolio-20260824',
  'MED+250 approved global ecommerce and official-source partner portfolio',
  'partner_agreement',
  'MED+250 product-owner confirmation dated 2026-08-24 that its local partnerships and copyright permissions cover the retained catalogue image portfolio; confidential agreements remain outside source control.',
  'Storage, transformation, and display of the exact registered catalogue image assets within MED+250, subject to the applicable underlying partner or copyright authorization and takedown controls.',
  1,
  'active',
  '2026-08-24T00:00:00.000Z',
  NULL,
  'MED+250 product owner',
  '2026-08-24T15:10:00.000Z',
  '2026-08-24T15:10:00.000Z',
  '2026-08-24T15:10:00.000Z'
);

-- Freeze the owner-confirmed legacy portfolio to exact content identities.
-- These rows were retained by migration 0009 and already contain the original
-- source URLs, content hashes, validated dimensions, background-removal state,
-- quality score, and immutable recovery receipt.
INSERT INTO med250_media_rights_policy_assets (
  policy_id, product_id, position, content_sha256, source_domain,
  registered_by, registered_at
)
SELECT
  'partner-portfolio-20260824',
  image.product_id,
  image.position,
  lower(image.content_sha256),
  lower(trim(image.source_domain)),
  'MED+250 product owner',
  '2026-08-24T15:10:00.000Z'
FROM med250_product_images image
WHERE image.rights_verified = 0
  AND image.content_sha256 IS NOT NULL
  AND image.source_domain IS NOT NULL;

DROP TRIGGER med250_product_images_rights_insert_guard;
DROP TRIGGER med250_product_images_rights_update_guard;

CREATE TRIGGER med250_product_images_rights_insert_guard
BEFORE INSERT ON med250_product_images
WHEN NEW.rights_verified = 1 AND (
  NEW.rights_policy_id IS NULL
  OR NEW.rights_verified_by IS NULL
  OR length(trim(NEW.rights_verified_by)) < 3
  OR NEW.rights_verified_at IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM med250_media_rights_policies policy
    WHERE policy.id = NEW.rights_policy_id
      AND policy.status = 'active'
      AND policy.effective_at <= NEW.rights_verified_at
      AND (policy.expires_at IS NULL OR policy.expires_at > NEW.rights_verified_at)
      AND (
        policy.domain_scope_required = 0
        OR EXISTS (
          SELECT 1
          FROM med250_media_rights_policy_domains domain
          WHERE domain.policy_id = policy.id
            AND (
              lower(trim(NEW.source_domain)) = domain.domain_suffix
              OR lower(trim(NEW.source_domain)) LIKE '%.' || domain.domain_suffix
            )
        )
        OR EXISTS (
          SELECT 1
          FROM med250_media_rights_policy_assets asset
          WHERE asset.policy_id = policy.id
            AND asset.product_id = NEW.product_id
            AND asset.position = NEW.position
            AND asset.content_sha256 = lower(NEW.content_sha256)
            AND asset.source_domain = lower(trim(NEW.source_domain))
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'rights_verified requires an active matching evidence policy');
END;

CREATE TRIGGER med250_product_images_rights_update_guard
BEFORE UPDATE OF
  product_id, position, content_sha256, source_domain,
  rights_verified, rights_policy_id, rights_verified_by, rights_verified_at
ON med250_product_images
WHEN NEW.rights_verified = 1 AND (
  NEW.rights_policy_id IS NULL
  OR NEW.rights_verified_by IS NULL
  OR length(trim(NEW.rights_verified_by)) < 3
  OR NEW.rights_verified_at IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM med250_media_rights_policies policy
    WHERE policy.id = NEW.rights_policy_id
      AND policy.status = 'active'
      AND policy.effective_at <= NEW.rights_verified_at
      AND (policy.expires_at IS NULL OR policy.expires_at > NEW.rights_verified_at)
      AND (
        policy.domain_scope_required = 0
        OR EXISTS (
          SELECT 1
          FROM med250_media_rights_policy_domains domain
          WHERE domain.policy_id = policy.id
            AND (
              lower(trim(NEW.source_domain)) = domain.domain_suffix
              OR lower(trim(NEW.source_domain)) LIKE '%.' || domain.domain_suffix
            )
        )
        OR EXISTS (
          SELECT 1
          FROM med250_media_rights_policy_assets asset
          WHERE asset.policy_id = policy.id
            AND asset.product_id = NEW.product_id
            AND asset.position = NEW.position
            AND asset.content_sha256 = lower(NEW.content_sha256)
            AND asset.source_domain = lower(trim(NEW.source_domain))
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'rights_verified requires an active matching evidence policy');
END;

CREATE TRIGGER med250_media_rights_policy_assets_no_update
BEFORE UPDATE ON med250_media_rights_policy_assets
BEGIN
  SELECT RAISE(ABORT, 'med250_media_rights_policy_assets are append-only');
END;

CREATE TRIGGER med250_media_rights_policy_assets_no_delete
BEFORE DELETE ON med250_media_rights_policy_assets
BEGIN
  SELECT RAISE(ABORT, 'med250_media_rights_policy_assets are append-only');
END;

UPDATE med250_product_images
SET rights_policy_id = 'partner-portfolio-20260824',
    rights_verified_by = 'MED+250 product owner',
    rights_verified_at = '2026-08-24T15:10:00.000Z',
    rights_verified = 1,
    rights_basis = 'Rights verified under MED+250 owner-confirmed multi-partner portfolio authorization; exact product, position, content hash, and source domain are registered.'
WHERE rights_verified = 0
  AND EXISTS (
    SELECT 1
    FROM med250_media_rights_policy_assets asset
    WHERE asset.policy_id = 'partner-portfolio-20260824'
      AND asset.product_id = med250_product_images.product_id
      AND asset.position = med250_product_images.position
      AND asset.content_sha256 = lower(med250_product_images.content_sha256)
      AND asset.source_domain = lower(trim(med250_product_images.source_domain))
  );

-- Restore publication only for the exact registered assets that still satisfy
-- the original technical and recovery-receipt contract.
UPDATE med250_product_images
SET approved = 1
WHERE rights_policy_id = 'partner-portfolio-20260824'
  AND rights_verified = 1
  AND r2_key IS NOT NULL
  AND content_sha256 IS NOT NULL
  AND source_page_url IS NOT NULL
  AND source_image_url IS NOT NULL
  AND source_domain IS NOT NULL
  AND source_kind IS NOT NULL
  AND rights_basis IS NOT NULL
  AND checked_at IS NOT NULL
  AND background_removed = 1
  AND width IS NOT NULL
  AND height IS NOT NULL
  AND recovery_receipt_id IS NOT NULL;

UPDATE med250_runtime_contract
SET expected_migration = '0010_expand_product_image_partner_portfolio',
    expected_applied_count = 10,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

PRAGMA defer_foreign_keys = off;

-- Restore the fail-closed product-image rights control that existed before the
-- Cloudflare cutover. D1 uses explicit INTEGER booleans and triggers because
-- existing tables cannot be retrofitted with a new table-level CHECK clause.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_media_rights_policies (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 12 AND 120),
  source_name TEXT NOT NULL CHECK (length(trim(source_name)) BETWEEN 2 AND 120),
  authorization_kind TEXT NOT NULL CHECK (authorization_kind IN (
    'partner_agreement', 'brand_permission', 'supplier_feed',
    'med250_capture', 'open_licence'
  )),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 20 AND 500),
  permitted_use TEXT NOT NULL CHECK (length(trim(permitted_use)) BETWEEN 20 AND 1000),
  domain_scope_required INTEGER NOT NULL DEFAULT 1 CHECK (domain_scope_required IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'expired')),
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  confirmed_by TEXT NOT NULL CHECK (length(trim(confirmed_by)) BETWEEN 3 AND 160),
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (expires_at IS NULL OR expires_at > effective_at)
) STRICT;

CREATE TABLE med250_media_rights_policy_domains (
  policy_id TEXT NOT NULL REFERENCES med250_media_rights_policies(id) ON DELETE RESTRICT,
  domain_suffix TEXT NOT NULL CHECK (
    domain_suffix = lower(domain_suffix)
    AND length(domain_suffix) BETWEEN 4 AND 253
    AND domain_suffix NOT LIKE '.%'
    AND domain_suffix NOT LIKE '%.'
    AND domain_suffix NOT LIKE '%/%'
    AND domain_suffix NOT LIKE '%:%'
  ),
  PRIMARY KEY (policy_id, domain_suffix)
) STRICT;

INSERT INTO med250_media_rights_policies (
  id, source_name, authorization_kind, evidence_reference, permitted_use,
  domain_scope_required, status, effective_at, expires_at,
  confirmed_by, confirmed_at, created_at, updated_at
) VALUES
  (
    'partner-amazon-20260824', 'Amazon', 'partner_agreement',
    'MED+250 product-owner confirmation dated 2026-08-24; confidential agreement retained outside source control.',
    'Use of exact Amazon product imagery within MED+250 as confirmed by the product owner, subject to the underlying agreement.',
    1, 'active', '2026-08-24T00:00:00.000Z', NULL,
    'MED+250 product owner', '2026-08-24T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
  ),
  (
    'partner-walmart-20260824', 'Walmart', 'partner_agreement',
    'MED+250 product-owner confirmation dated 2026-08-24; confidential agreement retained outside source control.',
    'Use of exact Walmart product imagery within MED+250 as confirmed by the product owner, subject to the underlying agreement.',
    1, 'active', '2026-08-24T00:00:00.000Z', NULL,
    'MED+250 product owner', '2026-08-24T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
  ),
  (
    'partner-ebay-20260824', 'eBay', 'partner_agreement',
    'MED+250 product-owner confirmation dated 2026-08-24; confidential agreement retained outside source control.',
    'Use of exact eBay product imagery within MED+250 as confirmed by the product owner, subject to the underlying agreement.',
    1, 'active', '2026-08-24T00:00:00.000Z', NULL,
    'MED+250 product owner', '2026-08-24T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'
  );

INSERT INTO med250_media_rights_policy_domains (policy_id, domain_suffix) VALUES
  ('partner-amazon-20260824', 'amazon.ae'),
  ('partner-amazon-20260824', 'amazon.ca'),
  ('partner-amazon-20260824', 'amazon.co.uk'),
  ('partner-amazon-20260824', 'amazon.co.za'),
  ('partner-amazon-20260824', 'amazon.com'),
  ('partner-amazon-20260824', 'amazon.com.au'),
  ('partner-amazon-20260824', 'amazon.com.br'),
  ('partner-amazon-20260824', 'amazon.de'),
  ('partner-amazon-20260824', 'amazon.in'),
  ('partner-amazon-20260824', 'amazon.sa'),
  ('partner-amazon-20260824', 'amazon.sg'),
  ('partner-amazon-20260824', 'media-amazon.com'),
  ('partner-amazon-20260824', 'ssl-images-amazon.com'),
  ('partner-walmart-20260824', 'walmart.ca'),
  ('partner-walmart-20260824', 'walmart.com'),
  ('partner-walmart-20260824', 'walmart.com.mx'),
  ('partner-walmart-20260824', 'walmartimages.com'),
  ('partner-ebay-20260824', 'ebay.com'),
  ('partner-ebay-20260824', 'ebayimg.com');

ALTER TABLE med250_product_images
  ADD COLUMN rights_verified INTEGER NOT NULL DEFAULT 0 CHECK (rights_verified IN (0, 1));
ALTER TABLE med250_product_images
  ADD COLUMN rights_policy_id TEXT REFERENCES med250_media_rights_policies(id) ON DELETE RESTRICT;
ALTER TABLE med250_product_images ADD COLUMN rights_verified_by TEXT;
ALTER TABLE med250_product_images ADD COLUMN rights_verified_at TEXT;

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
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'rights_verified requires an active matching evidence policy');
END;

CREATE TRIGGER med250_product_images_rights_update_guard
BEFORE UPDATE OF rights_verified, rights_policy_id, rights_verified_by, rights_verified_at, source_domain
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
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'rights_verified requires an active matching evidence policy');
END;

-- Deterministically map existing partner rows to the owner-confirmed policies.
UPDATE med250_product_images
SET rights_policy_id = (
      SELECT domain.policy_id
      FROM med250_media_rights_policy_domains domain
      WHERE lower(trim(med250_product_images.source_domain)) = domain.domain_suffix
         OR lower(trim(med250_product_images.source_domain)) LIKE '%.' || domain.domain_suffix
      ORDER BY length(domain.domain_suffix) DESC
      LIMIT 1
    ),
    rights_verified_by = 'MED+250 product owner',
    rights_verified_at = '2026-08-24T00:00:00.000Z',
    rights_verified = 1,
    rights_basis = CASE
      WHEN lower(trim(source_domain)) LIKE '%amazon%'
        THEN 'Rights verified under MED+250 confirmed Amazon partner authorization; exact source URLs, content hash, and recovery receipt retained.'
      WHEN lower(trim(source_domain)) LIKE '%walmart%'
        THEN 'Rights verified under MED+250 confirmed Walmart partner authorization; exact source URLs, content hash, and recovery receipt retained.'
      ELSE 'Rights verified under MED+250 confirmed eBay partner authorization; exact source URLs, content hash, and recovery receipt retained.'
    END
WHERE EXISTS (
  SELECT 1
  FROM med250_media_rights_policy_domains domain
  WHERE lower(trim(med250_product_images.source_domain)) = domain.domain_suffix
     OR lower(trim(med250_product_images.source_domain)) LIKE '%.' || domain.domain_suffix
);

-- Existing approval alone is not rights evidence. Hide everything that could
-- not be mapped before installing the approval guard.
UPDATE med250_product_images
SET approved = 0
WHERE rights_verified = 0;

CREATE TRIGGER med250_product_images_approved_insert_guard
BEFORE INSERT ON med250_product_images
WHEN NEW.approved = 1 AND (
  NEW.rights_verified <> 1
  OR NEW.rights_policy_id IS NULL
  OR NEW.rights_verified_by IS NULL
  OR NEW.rights_verified_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'approved product images require verified reuse rights');
END;

CREATE TRIGGER med250_product_images_approved_update_guard
BEFORE UPDATE OF approved, rights_verified, rights_policy_id, rights_verified_by, rights_verified_at
ON med250_product_images
WHEN NEW.approved = 1 AND (
  NEW.rights_verified <> 1
  OR NEW.rights_policy_id IS NULL
  OR NEW.rights_verified_by IS NULL
  OR NEW.rights_verified_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'approved product images require verified reuse rights');
END;

CREATE TRIGGER med250_media_rights_policy_withdrawal
AFTER UPDATE OF status ON med250_media_rights_policies
WHEN NEW.status <> 'active'
BEGIN
  UPDATE med250_product_images
  SET approved = 0, rights_verified = 0
  WHERE rights_policy_id = NEW.id;
END;

CREATE TRIGGER med250_media_rights_policies_no_delete
BEFORE DELETE ON med250_media_rights_policies
BEGIN
  SELECT RAISE(ABORT, 'med250_media_rights_policies cannot be deleted');
END;

CREATE TRIGGER med250_media_rights_policy_domains_no_update
BEFORE UPDATE ON med250_media_rights_policy_domains
BEGIN
  SELECT RAISE(ABORT, 'med250_media_rights_policy_domains are append-only');
END;
CREATE TRIGGER med250_media_rights_policy_domains_no_delete
BEFORE DELETE ON med250_media_rights_policy_domains
BEGIN
  SELECT RAISE(ABORT, 'med250_media_rights_policy_domains are append-only');
END;

DROP INDEX med250_product_images_public_idx;
CREATE INDEX med250_product_images_public_idx
  ON med250_product_images (product_id, position)
  WHERE approved = 1 AND rights_verified = 1;
CREATE INDEX med250_product_images_rights_pending_idx
  ON med250_product_images (source_kind, product_id, position)
  WHERE rights_verified = 0;
CREATE INDEX med250_product_images_rights_policy_idx
  ON med250_product_images (rights_policy_id, product_id, position)
  WHERE rights_verified = 1;

DROP VIEW med250_public_catalogue_rows;
CREATE VIEW med250_public_catalogue_rows AS
SELECT
  product.id,
  product.brand_name,
  product.generic_name,
  product.strength,
  product.dosage_form,
  product.pack_size,
  product.product_type,
  product.category,
  product.department,
  product.subcategory,
  product.prescription_status,
  product.regulatory_status,
  product.manufacturer,
  product.registration_number,
  product.indicative_price_rwf,
  product.indicative_price_basis,
  CASE WHEN product.description_approved = 1 THEN product.description ELSE NULL END AS description,
  image.legacy_public_url AS image_url,
  image.r2_key AS image_r2_key,
  image.quality_score AS image_quality_score
FROM med250_catalogue_products product
LEFT JOIN med250_product_images image
  ON image.product_id = product.id
  AND image.position = 1
  AND image.approved = 1
  AND image.rights_verified = 1
  AND EXISTS (
    SELECT 1
    FROM med250_media_rights_policies policy
    WHERE policy.id = image.rights_policy_id
      AND policy.status = 'active'
      AND policy.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND (policy.expires_at IS NULL OR policy.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
WHERE product.is_active = 1
  AND product.is_orderable = 1
  AND product.publication_status = 'approved';

UPDATE med250_runtime_contract
SET expected_migration = '0009_product_image_rights_gate',
    expected_applied_count = 9,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE contract_key = 'worker_runtime';

PRAGMA defer_foreign_keys = off;

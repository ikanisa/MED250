-- Catalogue, web order, marketplace, and governed operator data for D1.

PRAGMA defer_foreign_keys = on;

CREATE TABLE med250_catalogue_products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'rwanda_fda', 'governed_consumer_catalogue', 'local_governed_snapshot',
    'supabase_recovery', 'operator_correction'
  )),
  source_register TEXT,
  source_serial INTEGER,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_refreshed_at TEXT,
  registration_number TEXT,
  brand_name TEXT NOT NULL CHECK (length(trim(brand_name)) BETWEEN 1 AND 500),
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  pack_size TEXT,
  product_type TEXT NOT NULL,
  category TEXT NOT NULL,
  department TEXT NOT NULL,
  subcategory TEXT,
  prescription_status TEXT NOT NULL CHECK (prescription_status IN (
    'prescription', 'non_prescription', 'pharmacist_only', 'not_applicable', 'unclassified'
  )),
  regulatory_status TEXT NOT NULL,
  manufacturer TEXT,
  manufacturer_country TEXT,
  expiry_date TEXT,
  indicative_price_rwf INTEGER CHECK (indicative_price_rwf IS NULL OR indicative_price_rwf BETWEEN 1 AND 100000000),
  indicative_price_basis TEXT,
  indicative_price_source_url TEXT,
  indicative_price_updated_at TEXT,
  description TEXT,
  description_source_name TEXT,
  description_source_url TEXT,
  description_source_sha256 TEXT CHECK (description_source_sha256 IS NULL OR length(description_source_sha256) = 64),
  description_rights_basis TEXT,
  description_rights_reference TEXT,
  description_rights_verified INTEGER NOT NULL DEFAULT 0 CHECK (description_rights_verified IN (0, 1)),
  description_clinical_review_status TEXT,
  description_review_note TEXT,
  description_reviewed_by TEXT,
  description_reviewed_role TEXT,
  description_reviewed_at TEXT,
  description_approved INTEGER NOT NULL DEFAULT 0 CHECK (description_approved IN (0, 1)),
  publication_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (publication_status IN ('research_candidate', 'catalogue_review', 'approved', 'rejected')),
  compliance_status TEXT NOT NULL DEFAULT 'governed_source_import',
  compliance_evidence_url TEXT,
  reviewed_by_label TEXT,
  publication_review_note TEXT,
  publication_reviewed_at TEXT,
  publication_approved_at TEXT,
  is_orderable INTEGER NOT NULL DEFAULT 0 CHECK (is_orderable IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_register, source_serial),
  CHECK (publication_status = 'approved' OR (is_active = 0 AND is_orderable = 0)),
  CHECK (
    description_approved = 0 OR (
      description IS NOT NULL AND length(description) BETWEEN 40 AND 2000
      AND description_source_name IS NOT NULL
      AND description_source_url IS NOT NULL
      AND description_source_sha256 IS NOT NULL
      AND description_rights_basis IS NOT NULL
      AND description_rights_reference IS NOT NULL
      AND description_rights_verified = 1
      AND description_clinical_review_status IN ('approved', 'not_required')
      AND description_review_note IS NOT NULL
      AND description_reviewed_by IS NOT NULL
      AND description_reviewed_role IS NOT NULL
      AND description_reviewed_at IS NOT NULL
    )
  )
) STRICT;

CREATE INDEX med250_catalogue_products_public_idx
  ON med250_catalogue_products (is_active, is_orderable, department, category, id);
CREATE INDEX med250_catalogue_products_brand_idx
  ON med250_catalogue_products (brand_name, id);
CREATE INDEX med250_catalogue_products_registration_idx
  ON med250_catalogue_products (registration_number) WHERE registration_number IS NOT NULL;
CREATE INDEX med250_catalogue_products_publication_review_idx
  ON med250_catalogue_products (publication_status, department, id);

CREATE TABLE med250_catalogue_media_recovery_receipts (
  id TEXT PRIMARY KEY,
  source_project_ref TEXT NOT NULL CHECK (source_project_ref = 'uskfnszcdqpcfrhjxitl'),
  source_snapshot_sha256 TEXT NOT NULL CHECK (length(source_snapshot_sha256) = 64),
  import_snapshot_sha256 TEXT NOT NULL CHECK (length(import_snapshot_sha256) = 64),
  source_manifest TEXT NOT NULL CHECK (json_valid(source_manifest) AND json_type(source_manifest) = 'object'),
  gallery_count INTEGER NOT NULL CHECK (gallery_count > 0),
  image_count INTEGER NOT NULL CHECK (image_count > 0),
  byte_count INTEGER NOT NULL CHECK (byte_count > 0),
  target TEXT NOT NULL CHECK (target IN ('staging', 'production')),
  imported_at TEXT NOT NULL,
  UNIQUE (target, import_snapshot_sha256),
  CHECK (image_count BETWEEN gallery_count * 3 AND gallery_count * 6)
) STRICT;

CREATE TABLE med250_product_images (
  product_id TEXT NOT NULL REFERENCES med250_catalogue_products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  r2_key TEXT UNIQUE,
  legacy_public_url TEXT,
  source_page_url TEXT,
  source_image_url TEXT,
  source_domain TEXT,
  source_kind TEXT,
  rights_basis TEXT,
  width INTEGER CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height INTEGER CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  quality_score REAL NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  perceptual_hash TEXT CHECK (perceptual_hash IS NULL OR length(perceptual_hash) = 16),
  background_removed INTEGER NOT NULL DEFAULT 0 CHECK (background_removed IN (0, 1)),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  checked_at TEXT,
  recovery_receipt_id TEXT REFERENCES med250_catalogue_media_recovery_receipts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product_id, position),
  CHECK (
    approved = 0 OR (
      r2_key IS NOT NULL AND content_sha256 IS NOT NULL
      AND source_page_url IS NOT NULL AND source_image_url IS NOT NULL
      AND source_domain IS NOT NULL AND source_kind IS NOT NULL
      AND rights_basis IS NOT NULL AND checked_at IS NOT NULL
      AND background_removed = 1 AND width IS NOT NULL AND height IS NOT NULL
      AND recovery_receipt_id IS NOT NULL
    )
  )
) STRICT;
CREATE INDEX med250_product_images_public_idx
  ON med250_product_images (product_id, position) WHERE approved = 1;
CREATE INDEX med250_product_images_recovery_idx
  ON med250_product_images (recovery_receipt_id) WHERE recovery_receipt_id IS NOT NULL;

CREATE TABLE med250_catalogue_import_receipts (
  id TEXT PRIMARY KEY,
  source_snapshot_sha256 TEXT NOT NULL UNIQUE CHECK (length(source_snapshot_sha256) = 64),
  source_manifest TEXT NOT NULL CHECK (json_valid(source_manifest)),
  source_row_count INTEGER NOT NULL CHECK (source_row_count >= 0),
  inserted_count INTEGER NOT NULL CHECK (inserted_count >= 0),
  updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
  target TEXT NOT NULL CHECK (target IN ('staging', 'production')),
  imported_at TEXT NOT NULL,
  CHECK (inserted_count + updated_count <= source_row_count)
) STRICT;

CREATE VIEW med250_catalogue_taxonomy AS
SELECT department, subcategory, count(*) AS product_count
FROM med250_catalogue_products
WHERE is_active = 1 AND is_orderable = 1 AND publication_status = 'approved'
GROUP BY department, subcategory;

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
  ON image.product_id = product.id AND image.position = 1 AND image.approved = 1
WHERE product.is_active = 1 AND product.is_orderable = 1 AND product.publication_status = 'approved';

CREATE TABLE med250_web_order_items (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  product_id TEXT NOT NULL REFERENCES med250_catalogue_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) BETWEEN 1 AND 220),
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  pack_size TEXT,
  image_url TEXT,
  image_r2_key TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  customer_min_rwf INTEGER CHECK (customer_min_rwf IS NULL OR customer_min_rwf >= 0),
  customer_max_rwf INTEGER CHECK (customer_max_rwf IS NULL OR customer_max_rwf >= 0),
  substitutes_allowed INTEGER NOT NULL CHECK (substitutes_allowed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (request_id, product_id),
  UNIQUE (request_id, position),
  CHECK (customer_min_rwf IS NULL OR customer_max_rwf IS NULL OR customer_min_rwf <= customer_max_rwf),
  CHECK ((image_url IS NULL AND image_r2_key IS NULL) OR (image_url IS NOT NULL AND image_r2_key IS NOT NULL))
) STRICT;
CREATE INDEX med250_web_order_items_request_idx ON med250_web_order_items (request_id, id);

CREATE TABLE med250_marketplace_offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES med250_client_requests(id) ON DELETE CASCADE,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'selected', 'expired', 'withdrawn')),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  total_rwf INTEGER NOT NULL DEFAULT 0 CHECK (total_rwf BETWEEN 0 AND 1000000000),
  fulfilment_method TEXT NOT NULL DEFAULT 'either' CHECK (fulfilment_method IN ('pickup', 'delivery', 'either')),
  ready_in_minutes INTEGER CHECK (ready_in_minutes IS NULL OR ready_in_minutes BETWEEN 0 AND 1440),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (request_id, pharmacy_id),
  CHECK (
    (status = 'draft' AND complete = 0 AND submitted_at IS NULL)
    OR (status <> 'draft' AND complete = 1 AND submitted_at IS NOT NULL)
  )
) STRICT;
CREATE INDEX med250_marketplace_offers_request_idx
  ON med250_marketplace_offers (request_id, status, updated_at);
CREATE INDEX med250_marketplace_offers_pharmacy_idx
  ON med250_marketplace_offers (pharmacy_id, status, updated_at);

CREATE TABLE med250_marketplace_offer_items (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES med250_marketplace_offers(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES med250_web_order_items(id) ON DELETE RESTRICT,
  offered_product_id TEXT REFERENCES med250_catalogue_products(id) ON DELETE RESTRICT,
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  is_substitute INTEGER NOT NULL DEFAULT 0 CHECK (is_substitute IN (0, 1)),
  unit_price_rwf INTEGER CHECK (unit_price_rwf IS NULL OR unit_price_rwf BETWEEN 1 AND 100000000),
  quantity INTEGER CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 99),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL,
  UNIQUE (offer_id, order_item_id),
  CHECK (
    (available = 1 AND offered_product_id IS NOT NULL AND quantity IS NOT NULL)
    OR (available = 0 AND offered_product_id IS NULL AND is_substitute = 0 AND unit_price_rwf IS NULL AND quantity IS NULL)
  )
) STRICT;
CREATE INDEX med250_marketplace_offer_items_offer_idx
  ON med250_marketplace_offer_items (offer_id, order_item_id);

CREATE TABLE med250_pharmacy_contact_change_requests (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE CASCADE,
  requested_by_principal_id TEXT NOT NULL REFERENCES med250_web_principals(id) ON DELETE RESTRICT,
  contact_id TEXT REFERENCES med250_pharmacy_contacts(id) ON DELETE RESTRICT,
  requested_action TEXT NOT NULL CHECK (requested_action IN ('add', 'update', 'remove')),
  requested_contact_type TEXT NOT NULL CHECK (requested_contact_type IN ('phone', 'whatsapp')),
  requested_e164 TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_at TEXT,
  reviewed_by_label TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (requested_action = 'add' AND contact_id IS NULL AND requested_e164 IS NOT NULL)
    OR (requested_action = 'update' AND contact_id IS NOT NULL AND requested_e164 IS NOT NULL)
    OR (requested_action = 'remove' AND contact_id IS NOT NULL AND requested_e164 IS NULL)
  )
) STRICT;
CREATE INDEX med250_pharmacy_contact_change_pending_idx
  ON med250_pharmacy_contact_change_requests (pharmacy_id, created_at) WHERE status = 'pending';

CREATE TABLE med250_catalogue_price_contributions (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES med250_catalogue_products(id) ON DELETE RESTRICT,
  submitted_price_rwf INTEGER NOT NULL CHECK (submitted_price_rwf BETWEEN 1 AND 100000000),
  previous_price_rwf INTEGER CHECK (previous_price_rwf IS NULL OR previous_price_rwf BETWEEN 1 AND 100000000),
  resulting_price_rwf INTEGER NOT NULL CHECK (resulting_price_rwf BETWEEN 1 AND 100000000),
  contribution_status TEXT NOT NULL CHECK (contribution_status IN ('initialized', 'lowered', 'not_lower')),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX med250_catalogue_price_contributions_product_idx
  ON med250_catalogue_price_contributions (product_id, created_at);
CREATE INDEX med250_catalogue_price_contributions_pharmacy_idx
  ON med250_catalogue_price_contributions (pharmacy_id, created_at);

CREATE TABLE med250_pharmacy_claims (
  id TEXT PRIMARY KEY,
  pharmacy_id TEXT NOT NULL REFERENCES med250_pharmacies(id) ON DELETE RESTRICT,
  submitted_by_principal_id TEXT NOT NULL REFERENCES med250_web_principals(id) ON DELETE RESTRICT,
  contact_email TEXT NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 254),
  contact_phone TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX med250_pharmacy_claims_pending_idx
  ON med250_pharmacy_claims (pharmacy_id) WHERE status = 'pending';

CREATE TABLE med250_public_metric_approvals (
  metric_key TEXT PRIMARY KEY CHECK (metric_key IN ('ready_pharmacy_count', 'typical_response_time')),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  reviewed_by TEXT,
  evidence_reference TEXT,
  approved_at TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    approved = 0 OR (
      reviewed_by IS NOT NULL AND evidence_reference IS NOT NULL
      AND approved_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > approved_at
    )
  )
) STRICT;

PRAGMA defer_foreign_keys = off;

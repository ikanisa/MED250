# MED+250 product image pipeline

The pipeline covers the complete 4,680-row source dataset and retains image
allocation evidence for the prior 4,659-product catalogue. Two non-product
source records are now governed exclusions, leaving 4,657 publishable products; the exact
production target is 23,977 images: 3,977 products receive five images and 682
products receive six. Missing products are published first as atomic
three-image galleries, then upgraded on later passes to their deterministic
five- or six-image final allocation. This makes the required minimum coverage
live early without accepting a partial gallery or weakening validation.

## Source priority

Use sources in this order:

1. Manufacturer pages and licensed supplier feeds supplied with
   `--source-manifest`.
2. Manufacturer product pages and their original high-resolution assets.
3. Amazon and other major marketplace product listings.
4. Specialist pharmacy, retailer, and ecommerce product listings.

Public discovery records the exact source page and source image URL for
traceability. It never fabricates proof of reuse rights: automated sources are
published with `rights_verified=false`, a truthful `rights_basis`, and durable
source provenance. A genuinely verified licence may set `rights_verified=true`,
but it is not an automated-publication prerequisite.

The first public-search pass queries independent Bing, DuckDuckGo, and Yandex
indexes concurrently, so one provider's latency or unusable result set cannot
suppress better manufacturer or specialist-retailer results. Candidate image
downloads also run in bounded parallel windows; OCR and background removal stay
sequential inside each worker to cap memory. Yandex's embedded result payload
provides original-resolution image URLs, dimensions, and listing-page
provenance in one request. An optional `SERPAPI_API_KEY` adds structured Google
Images originals without changing any validation or rights policy. Exact
medicine results trigger bounded listing-page gallery discovery.

For an exact consumer ASIN, the pipeline first reads the selected product's
public Amazon `colorImages.initial` gallery. It verifies the page's current ASIN,
honors robots.txt, ignores other size/color variant galleries and recommended
products, caches only the compact parsed result, and retains the exact product
page plus original image URL as provenance. No Product Advertising/Creators API
approval is required for this public-page resolver. Known thumbnail URL formats
from Amazon, Walmart, eBay, Shopify, Next.js, IndiaMART, Pinterest, and generic
WordPress/CDN size parameters are upgraded to original-resolution variants
before the normal identity and image-safety validation runs.

Example manifest:

```json
[
  {
    "product_id": "rwanda-fda-hm-0001",
    "source_page_url": "https://manufacturer.example/products/atop-250-100",
    "source_kind": "manufacturer",
    "rights_basis": "Public manufacturer listing; source URLs retained; reuse rights not independently verified.",
    "rights_verified": false,
    "priority": 100,
    "images": [
      "https://manufacturer.example/images/atop-front.jpg",
      "https://manufacturer.example/images/atop-back.jpg",
      "https://manufacturer.example/images/atop-side.jpg"
    ]
  }
]
```

Amazon Creators API exports may use `asin` instead of `product_id`; the script
maps the ASIN to `AMZ-{ASIN}`.

## Install

Use Python 3.11 or newer in a dedicated virtual environment because the
security-supported `rembg`, Pillow, and RapidOCR releases require a modern
runtime and install an ONNX runtime:

```sh
python3.11 -m venv .venv-product-images
source .venv-product-images/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-product-images.txt
```

The requirement files use exact versions and `npm run security:audit:python`
checks every pin against the OSV vulnerability database. Do not relax the pins
or install the image pipeline into the macOS system Python.

Source policies and manifests are optional. The persistent workers always load
`data/product-images/official-source-manifest.json`, which contains vetted
official-source derivatives for products whose exact package artwork is
available only in regulator documents.

Medicine retries also issue a tightly quoted Vietnamese pharmacy query using
the registered brand and generic name. This recovers exact export-pack
galleries that are absent from English-language rankings while preserving the
same brand, strength, manufacturer, dosage-form, OCR, and provenance gates.
OCR dosage-form matching includes exact French and Spanish package terms (for
example `gélules` and `cápsulas`). Concatenated registry strengths such as
`266MG` are removed only from brand-token comparison and remain mandatory in
the independent structured-strength check.
Bracketed scientific descriptions appended to a registered trade name are
validated as generic identity instead of brand tokens. Exact primary
manufacturer images of injectable kits may contain two or three components
(such as a freeze-dried vial and supplied diluent) when the complete visual
medicine identity gate passes; this does not exempt marketing collages.
When a regulator's brand field appends a matching structured strength and a
full dosage description, only the prefix before that strength is treated as
the trade name. The independent strength, ingredient, manufacturer, form, OCR,
and visual gates remain mandatory.

Google Custom Search is optional and only works for existing API customers:

```sh
export GOOGLE_CSE_API_KEY=...
export GOOGLE_CSE_ID=...
```

Google closed the Custom Search JSON API to new customers and announced its
January 1, 2027 discontinuation. New deployments should normally use licensed
partner/manufacturer exports in the manifest format.

## Supabase setup

Apply the image-gallery migration. It creates:

- the public-read, service-write `dawanear_product_images` table;
- the public `product-images` Storage bucket;
- the service-only `dawanear_publish_product_images` RPC;
- an independent approval trigger that rejects an unsafe row even if another
  migration removes the equivalent check constraint;
- a DDL event guard that rejects schema changes leaving the background-removal
  constraint, public RLS policy, runtime trigger, or publication RPC unsafe;
- atomic primary-image linkage into the existing catalogue.

## Dry run

```sh
python scripts/enrich_product_images.py \
  --limit 25
```

The script checkpoints every product in
`data/product-images/checkpoint.sqlite3`. Re-running skips published products
unless `--force` is supplied.

Candidate labels are read with local OCR. Images that show a conflicting pack
size or medicine strength are rejected even when they came from the correct
ASIN or product page, preventing marketplace variant galleries from leaking
into another catalogue item.

Exact edge-to-edge book, journal, and planar package fronts use a separate
transparent-inset path when their portrait geometry, source identifier, and OCR
title coverage all agree. This avoids fragmenting a real cover with neural
background removal while keeping lifestyle and generic marketing graphics out.
Regulatory medicine rows that repeat a generic composition in both brand and
generic fields may be discovered through their registered manufacturer page,
but publication still requires the manufacturer, dosage form, every distinctive
ingredient, and every parsed strength to match the image evidence.

## Publish

Use the secret key only in a trusted operator process:

```sh
export SUPABASE_URL=https://PROJECT.supabase.co
export SUPABASE_SECRET_KEY=...

python scripts/enrich_product_images.py \
  --publish
```

Before a worker process begins writing, its wrapper verifies live backend
contract `2026-07-18.3`. A short-lived, versioned local attestation prevents
four workers from repeatedly invoking the aggregate contract RPC at startup;
the Python publisher accepts it only when both the exact environment version
and fresh attestation file agree. Direct/manual runs still verify the RPC. The
publisher refuses to write unless automated provenance mode, the 23,977-image
target, background-removal public policy, independent runtime trigger, and DDL
event guard are active. Publication is atomic and requires either the initial
three-image coverage gallery or the complete five/six-image top-up to have
distinct content and perceptual hashes. A failed top-up leaves the existing
three-image live gallery untouched. Storage paths contain the processed image
SHA-256, making repeated runs idempotent and avoiding stale overwritten CDN
assets.

Coverage and final-quality selection are intentionally staged. During the
three-image minimum pass, one exact source asset that passes every identity,
OCR, resolution, background, and provenance gate can immediately produce three
distinct catalogue views. The later five/six-image final-allocation pass waits
for up to three independent source assets and atomically replaces the staged
gallery. This keeps the full catalogue live quickly without weakening the final
selection policy.

On the linked MED+250 macOS operator machine, run the secret-free wrapper in a
Terminal session so the process retains access to the external catalogue drive:

```sh
osascript -e 'tell application "Terminal" to do script \
  "cd /Volumes/PRO-G40/MED250 && \
   ./scripts/run_product_image_worker.zsh \
   >> /tmp/med250-product-images-live-shard-0.log 2>&1"'
```

The wrapper retrieves the authenticated Supabase CLI token from macOS Keychain,
resolves the server-side project key in memory, verifies the backend contract,
and resumes from its SQLite checkpoint. It fails closed instead of falling back
to the macOS system Python. Production uses the validated topology in
`scripts/product_image_worker_topology.zsh`: four non-overlapping ranges at
offsets 0, 1165, 2330, and 3495, covering the retained 4,659-row image-allocation set. The
launchd watchdog restarts missing workers and the monitor, with staggered worker
startup to avoid a Supabase request burst. The monitor writes aggregate progress
before running the longer public-URL audit and derives the active validation
policy version directly from the Python pipeline. The persistent launcher reads
the same topology copy installed in Application Support, runs coverage-first
while any product has fewer than three images, automatically switches to the
deterministic five/six-image final allocation, and stops relaunching workers only
after the 23,977-row and 4,659-gallery asset-integrity gates both pass. Public
catalogue eligibility is evaluated separately and currently excludes two rows.

For a medicine-heavy backlog, `run_medicine_product_image_fastlane.zsh` pauses
the four persistent wrappers, terminates their memory-heavy child processes,
and uses ten contiguous medicine shards. Each shard consumes cached manifests
first and then performs one exact query per public index concurrently. The four
persistent workers are resumed automatically when the focused sweep exits.

`build_catalog_sitemap_candidate_manifest.py` is the catalogue-first discovery
lane for the residual medicine backlog. It reads robots-advertised sitemaps
from manufacturer and specialist-pharmacy domains that have already produced
approved galleries, performs an inverted-index match across the registered
catalogue locally, and fetches only exact-looking product pages. Supabase is
queried read-only so completed galleries are excluded before page hydration.
The generated `catalog-sitemap-candidates.json` and
`truemeds-sitemap-candidates.json` manifests are loaded automatically by every
worker. Set `MED250_MEDICINE_CATALOG_ONLY=1` on a focused fast-lane run to
validate these manifests without paying for another public-search pass; the
normal OCR, strength, form, pack, image-quality, background, provenance, and
deduplication gates remain unchanged.

`run_live_gallery_final_topup.zsh` accelerates the deterministic final count
without repeating source discovery or weakening validation. It downloads each
already-approved Storage object, requires its bytes to reproduce the database
SHA-256, preserves the original source/rights metadata, derives only
perceptually distinct additional catalogue views, uploads the additions, and
atomically republishes the exact five/six-image allocation. Products below the
three-image minimum are skipped, so coverage discovery remains the only path
that can create an initial gallery.

## Verify

```sh
python scripts/enrich_product_images.py --publish --verify-only
```

`data/product-images/live-url-verification.json` must report 23,977 published
images, 4,659 retained source products with their allocated gallery sizes,
`"missing_or_incomplete_count": 0`, `"broken_public_url_count": 0`, and
`"complete": true`. Successful uploads alone are not the release gate; the
full Supabase and public-URL verification is.

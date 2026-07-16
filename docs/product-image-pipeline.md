# MED+250 product image pipeline

The pipeline covers the complete 4,680-row source dataset and, during a
production run, filters it to products currently visible in the live Supabase
catalogue. A product is published only after exactly three distinct,
high-resolution, background-free images pass validation.

## Source priority

Use sources in this order:

1. Licensed supplier/manufacturer feeds supplied with `--source-manifest`.
2. Manufacturer product pages and their original high-resolution assets.
3. Amazon or other marketplace image results discovered by public image search.
4. Specialist pharmacy, retailer, and marketplace product listings.

Public image discovery is enabled by default and needs no search API key.
`rights_basis` is optional; when omitted, the script records that the public
listing was discovered automatically and that reuse rights were not
independently verified. Source page and original image URLs are always stored.

Example manifest:

```json
[
  {
    "product_id": "rwanda-fda-hm-0001",
    "source_page_url": "https://manufacturer.example/products/atop-250-100",
    "source_kind": "manufacturer",
    "rights_basis": "Manufacturer product page approved for MED+250 catalogue use.",
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
security-supported `rembg` and Pillow releases require a modern runtime and
`rembg` installs an ONNX runtime:

```sh
python3.11 -m venv .venv-product-images
source .venv-product-images/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-product-images.txt
```

The requirement files use exact versions and `npm run security:audit:python`
checks every pin against the OSV vulnerability database. Do not relax the pins
or install the image pipeline into the macOS system Python.

The source policy and manifests are optional accelerators. Without them, the
script searches public product listings automatically.

Google Custom Search is optional and only works for existing API customers:

```sh
export GOOGLE_CSE_API_KEY=...
export GOOGLE_CSE_ID=...
```

Google closed the Custom Search JSON API to new customers and announced its
January 1, 2027 discontinuation. New deployments should normally use licensed
partner/manufacturer exports in the manifest format.

## Supabase setup

Apply `supabase/migrations/20260716140000_product_image_gallery.sql`. It creates:

- the public-read, service-write `dawanear_product_images` table;
- the public `product-images` Storage bucket;
- the service-only `dawanear_publish_product_images` RPC;
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

## Publish

Use the secret key only in a trusted operator process:

```sh
export SUPABASE_URL=https://PROJECT.supabase.co
export SUPABASE_SECRET_KEY=...

python scripts/enrich_product_images.py \
  --publish
```

The command exits non-zero if any selected live product has fewer than three
validated images. Storage paths contain the processed image SHA-256, making
repeated runs idempotent and avoiding stale overwritten CDN assets.

## Verify

```sh
python scripts/enrich_product_images.py --publish --verify-only
```

`data/product-images/report.json` must report `"complete": true` and
`"missing_or_incomplete_count": 0`. Successful uploads alone are not the
release gate; the final Supabase verification is.

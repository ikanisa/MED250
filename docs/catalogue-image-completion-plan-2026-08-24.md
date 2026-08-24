# MED+250 catalogue image completion and approval plan

Date: 2026-08-24

## Executive decision

The product owner has confirmed that MED+250 has local partnership approvals and image/copyright permissions across a broader global ecommerce and official-source partner portfolio. Amazon, Walmart, and eBay are named examples within that portfolio, not an exhaustive allowlist. Standard public programme terms do not displace MED+250's separate partnership permissions.

Confidential contracts do not need to be placed in source control. Each imported image must nevertheless map to an approved source-policy or agreement record so that its `rights_verified` value is evidence-backed and auditable.

The completion programme should use this order:

1. Exact assets obtained through any MED+250-approved marketplace, ecommerce, supplier, or official-source partnership/API, including Amazon, Walmart, and eBay.
2. Exact official asset supplied or licensed by the manufacturer, marketing authorisation holder, or local technical representative.
3. Licensed GS1/GDSN, distributor, supplier, or brand-owner feed tied to a GTIN or an exact registered product variant.
4. MED+250-controlled physical photography of the exact pack, with contributor rights and custody evidence.
5. A clearly labelled synthetic or generic visual placeholder only when no authentic asset is available. It must never be presented as the actual medicine pack and does not count as authentic product-image coverage.

The current `approved` flag must be supported by separate rights-verification, technical-validation, exact-product-identity, human-review, and public-publication states. Cloudflare D1 must restore the fail-closed `rights_verified` gate that existed in Supabase. Partner agreements provide the evidence used to verify covered images; they do not bypass the gate.

## Verified production baseline

Post-restoration readback after migrations `0009` and `0010` on 2026-08-24:

| Measure | Current production state |
|---|---:|
| Public active catalogue products | 4,678 |
| Products with rights-verified approved galleries | 3,278 |
| Rights-verified approved image rows in Cloudflare D1/R2 | 17,041 |
| Approved image rows without verified rights | 0 |
| Retained but unpublished rights-pending image rows | 0 |
| Exact assets registered under the broader portfolio policy | 7,929 |
| Products with no retained image to restore | 1,400 |
| Rwanda FDA products requiring new acquisition | 1,332 |
| Governed consumer products requiring new acquisition | 68 |

Migration `0009_product_image_rights_gate.sql` restored the fail-closed D1 control. Migration `0010_expand_product_image_partner_portfolio.sql` then corrected the initial three-platform interpretation: it registered all 7,929 retained rows covered by the product owner's broader confirmation using exact product ID, gallery position, content SHA-256, and source domain. All 17,041 retained rows are now approved and rights-verified; an unknown future asset from the same domain is not automatically authorized.

The earlier sourcing inventory identified 410 technically failed candidate galleries and 990 products with no selected source gallery. Those queues reconcile exactly to the current 1,400-product acquisition gap: 1,332 medicines and 68 consumer products. Of these, 1,379 are currently orderable and 21 are active catalogue records that are not orderable.

The 410 validation failures divide into 360 medicines and 50 consumer products. A deterministic review of the recorded failures gives this work queue:

| Failure class | Products | Correct response |
|---|---:|---|
| Identity, strength, dosage form, or pack mismatch | 282 | Reject the candidate; obtain an exact variant or photograph the registered pack. Do not weaken OCR/identity rules. |
| Insufficient resolution/effective product size | 87 | Request the original file or reshoot. Upscaling is allowed only after exact identity and rights are verified and must not reconstruct label text. |
| Marketing scene/full-frame graphic | 14 | Find an official isolated packshot or reshoot. |
| Fragmented cutout | 9 | Reprocess only if the original is exact and `rights_verified`; otherwise replace. |
| Blank/placeholder | 6 | Replace. |
| Human present | 2 | Replace with an isolated product image. |
| Other policy failure | 10 | Manual triage with the same fail-closed rules. |

The pre-enforcement 990 products with no selected gallery were 972 medicines and 18 active consumer products. Combined with the 410 failed galleries, the remaining authentic-image acquisition queue is 1,332 medicines and 68 consumer products.

## Approval-model adjustment

Before migration `0009`, the Cloudflare `med250_product_images` table recorded `approved`, source URLs, a free-text `rights_basis`, quality values, and hashes but lacked the enforceable `rights_verified` state used by the earlier Supabase design. D1 now records and enforces that state for image approval, and the remaining approval-model fields below are still to be completed.

The historical Supabase migration `20260716170000_enforce_verified_product_image_rights.sql` was the reference control. Its fail-closed principle is now restored in Cloudflare D1: an image cannot be approved or publicly projected unless `rights_verified = 1`. The D1 implementation adapts the control to the current schema rather than copying Supabase-specific RLS or its former exactly-three-images rule verbatim.

The enrichment code also treats `marketplace_api`, `specialist_retailer`, and `manufacturer` as source classifications rather than legal permissions. Some marketplace and directory domains are even classified as manufacturers by name matching. Source reputation and legal permission must become independently controlled fields.

Finally, the current pipeline targets three to six images and derives alternate catalogue views from a smaller number of originals. Completion should instead require at least one authentic, rights-verified primary image. Positions two to six should exist only when they show genuinely distinct, source-backed views such as front, back, side, contents, or a verified pack configuration. Artificially derived crops or tilts must not be counted as distinct product evidence.

## Source ladder

### Tier 1 — approved global ecommerce and marketplace partnerships

Use every approved partner API and feed as a primary source wherever the applicable agreement covers MED+250's use case. Amazon, Walmart, and eBay remain high-volume examples, not the boundary of this tier.

- For Amazon catalogue products, use the exact ASIN already embedded in each `AMZ-...` product ID. Do not use visual or keyword similarity when the ASIN is available.
- For Walmart and eBay, prefer GTIN/UPC/EAN plus brand, model, variant, size, and pack count. A marketplace listing title alone is not an exact identity key.
- Store the provider API, partner/account identifier, response timestamp, item identifier, source image URL, agreement/source-policy reference, permitted-use basis, and content hash with every imported original.
- Apply any configured attribution, deep-link, refresh, notice, or takedown behaviour automatically from the partner source policy.

This route should first close the current 68-product consumer gap: 50 already had candidates that failed visual validation, and 18 had no selected gallery. Run exact partner-API recovery across all 68 without guessing; use GTIN/UPC/EAN, ASIN, brand, variant, size, and pack count to prevent cross-variant matches.

### Tier 2 — local technical representatives and marketing authorisation holders

This is the fastest route for medicines. The Rwanda FDA source register already contains the manufacturer, marketing authorisation holder, and local technical representative for each registered product.

- In the current 1,332-medicine queue, 118 local technical representatives were historically known and only nine records lacked one. Recompute these assignments before sending requests.
- Historically, the top 10 representatives covered 860 products and the top 25 covered 1,065.
- The historical largest queues included Sun Enterprises (263), Abacus Pharma (220), Kipharma (89), Surgipharm Rwanda (64), Wessex Pharmaceuticals Rwanda (61), Depot Pharmaceutique Le Medical (49), Phillips Pharmaceuticals Rwanda (32), Bion Pharma Group (29), Rene Pharmacy Rwanda (28), and Aiveen Rwanda (25).

Send each representative a structured request containing the Rwanda FDA registration number, exact brand, generic, strength, dosage form, pack size, manufacturer, and a requested asset checklist. Ask for:

- the current Rwanda-market front, back, and side pack images;
- GTIN/barcode where available;
- confirmation that the supplied pack corresponds to the listed registration number;
- a written, non-exclusive licence for MED+250 to store, resize, background-normalise, and display the asset in its pharmacy catalogue;
- effective and expiry dates, territorial limits, attribution requirements, and a named authorising contact.

One representative response can close hundreds of exact products and create strong source evidence.

### Tier 3 — official manufacturer catalogues and media desks

Automate exact searches on manufacturer-owned domains and product catalogues, but do not treat the presence of a file as permission. Existing official catalogues already discovered in the codebase include Rene Industries and Laboratory & Allied; current official sites for Lincoln, Micro Labs, and Ajanta also expose product/catalogue pages.

In the pre-enforcement queue, the top 25 normalized manufacturers accounted for 582 medicines and the top 50 for 759. Recompute those totals against the current rights-verified backlog, then work manufacturer by manufacturer rather than product by product. Request a feed or media pack keyed by registration number, brand, strength, form, pack size, and GTIN.

### Tier 4 — GS1/GDSN or contracted supplier feed

Join or contract through a certified GS1 GDSN data pool where coverage exists. GS1 defines product-image and pharmaceutical-image specifications, supports a primary-image indicator, validity periods, and GTIN-linked digital-asset URLs. The feed agreement must state MED+250's display, transformation, retention, and termination rights.

Use GTIN plus registered variant attributes as the join key. A fuzzy brand-name match is not sufficient.

### Tier 5 — uncovered marketplaces and specialist retailers

Any marketplace or specialist retailer covered by MED+250's partner portfolio is governed by Tier 1. A source outside that portfolio remains a discovery channel until its agreement or exact-asset authorization is registered.

Permitted uses in this programme:

- discover a likely exact product and manufacturer;
- extract identifiers such as ASIN, GTIN, model, pack count, or regional variant;
- compare the candidate visually during internal review;
- link to a live marketplace image only when the applicable API contract permits that display and refresh pattern.

Prohibited for sources not covered by a registered agreement:

- download and persist the marketplace image to R2;
- remove its background or create derived files;
- classify it as an approved MED+250 partner source;
- use it as a MED+250 product image simply because it is publicly accessible.

The restored marketplace-heavy library is mapped to the owner-confirmed portfolio at exact-asset level. New assets must map to their applicable named partner policy or an exact-asset authorization; uncovered assets remain quarantined.

### Tier 6 — controlled physical pack photography

For products not closed by tiers 1–3, capture the exact pack at a participating licensed pharmacy or distributor.

Minimum capture set:

- front face;
- back face with manufacturer and registration/label evidence;
- one side showing strength, dosage form, or pack configuration;
- optional contents view only when safe and appropriate.

The contributor workflow must record product ID, registration number, barcode/GTIN, pharmacy or supplier, photographer, capture date, contributor licence, and the untouched originals. Do not photograph customer prescriptions or personal data. Do not open sterile or sealed packs merely to produce a gallery.

### Tier 7 — ImageGen and synthetic visuals

ImageGen is appropriate only for clearly non-authentic visuals:

- neutral category illustrations;
- an “image pending verification” catalogue tile;
- generic health-and-wellness imagery that does not depict a specific branded pack;
- non-product educational or marketing artwork outside the exact product gallery.

ImageGen must not invent the packaging, tablets, bottle, colour, logo, registration number, strength, barcode, pack count, or manufacturer appearance of a real medicine. A synthetic branded medicine pack could be mistaken for the dispensed product even when small disclosure text exists, especially in card thumbnails.

Every synthetic asset must have `asset_class = 'synthetic_placeholder'`, `synthetic_disclosure = 1`, a model/tool receipt, prompt hash, generation time, reviewer, and a visible `Illustration — not actual packaging` label. It must not satisfy the authentic-image completion metric and must never be served from the exact product-media route as if it were an approved packshot.

The existing deterministic generated-medicine carton fallback should be retired from publication use. If retained for internal previews, it must stay outside the public product gallery.

## Required data model

Add a governed candidate and approval model before importing further images.

Suggested image fields or linked approval records:

- `asset_class`: `authentic_packshot`, `physical_capture`, `synthetic_placeholder`, `category_art`;
- `view_type`: `front`, `back`, `left`, `right`, `contents`, `other`;
- `technical_status`: `pending`, `passed`, `failed`;
- `identity_status`: `pending`, `exact`, `rejected`, `needs_review`;
- `rights_verified`: boolean, default `0`, set to `1` only when the exact asset maps to durable authorization evidence;
- `rights_verified_at`, `rights_verified_by`, `rights_policy_id`, and `rights_basis`;
- `source_authorization`: `approved_partner`, `official_source`, `med250_capture`, `open_web_review`, `generated`;
- optional `agreement_id`, `partner_account_id`, `attribution_rule`, `refresh_rule`, and `takedown_rule`;
- `source_authority`: `manufacturer`, `mah`, `ltr`, `gs1_gdsn`, `med250_capture`, `marketplace_discovery`, `generated`;
- `registration_number`, `gtin`, `asin`, and normalized variant fingerprint;
- `reviewed_by`, `reviewed_role`, `reviewed_at`, `review_note`, `approval_policy_version`;
- `synthetic_disclosure`, `generation_receipt`, and `prompt_sha256` where applicable;
- existing source URLs, content hash, perceptual hash, dimensions, and R2 key.

Public publication must require:

```text
technical_status = passed
AND identity_status = exact
AND rights_verified = 1
AND human_approval = approved
AND asset_class IN (authentic_packshot, physical_capture)
```

Synthetic placeholders use a separate presentation path and status. They are never silently promoted to product media.

## Exact identity gate

For a medicine, the source and visible pack must agree with all available critical fields:

- Rwanda FDA registration number or an authoritative mapping to it;
- brand;
- active ingredient/generic;
- strength and concentration;
- dosage form;
- pack count or volume;
- manufacturer/MAH;
- regional variant where packaging differs.

A conflict in any critical field is a hard rejection. OCR uncertainty routes to human review; it does not lower the threshold. For consumer items, exact ASIN/GTIN/model, brand, variant, colour where material, size, and pack count must match.

## Cloudflare intake and publication design

1. Upload untouched candidates to a private quarantine prefix such as `catalogue-intake/<source-receipt>/<sha256>`.
2. Record candidate metadata and source provenance in D1 with rights, technical, and identity states pending.
3. Run malware/type checks, decode validation, OCR, exact-identity rules, resolution/background checks, and perceptual duplicate detection.
4. Create normalized WebP derivatives under an immutable content-addressed key only after the original has passed the technical gate.
5. Require rights, product-identity, and technical review of the candidate receipt.
6. Publish with a single receipt that links D1 rows to existing R2 object checksums/ETags. R2 objects are written before D1 publication; failure leaves them quarantined, never public.
7. Read back D1, R2 HEAD/GET, checksum, MIME type, dimensions, and the public product route. Purge a cached 404 if a previously absent key has just been created.
8. Keep an old asset public only while it remains rights-verified and otherwise valid. After a replacement is live and verified, move the old record to `superseded`; move any asset without adequate authorization evidence to `rights_rejected` and remove it from public projection. Do not destructively overwrite immutable keys.

For bulk ingestion, use the R2 S3-compatible API rather than one-file-at-a-time Wrangler uploads. Preserve SHA-256 checksums in D1 and R2 custom metadata and use conditional writes to prevent accidental replacement.

## Execution workstreams

### Workstream A — restore the D1 rights gate and prepare the queue (days 1–3)

Status: rights-gate implementation, broader portfolio correction, exact-asset registration, restoration, and production readback completed on 2026-08-24. The new-acquisition queue and operator workflow items below remain open.

- Create source-policy records for every approved partner API/feed/account, including permitted uses, attribution, refresh, and takedown behaviour. Keep confidential agreement details outside the repository while storing durable references in D1.
- Add `rights_verified INTEGER NOT NULL DEFAULT 0`, rights-audit fields, and database constraints/triggers that reject `approved = 1` unless rights, technical, identity, and human-review gates pass.
- Update every public D1 query and Worker response to require `approved = 1 AND rights_verified = 1`; service-only writes must not be able to omit the rights decision.
- Backfill named-domain partner rows through their domain policies and the confirmed retained portfolio through exact product/position/hash/domain registrations. Rows without either mapping remain `rights_verified = 0` and must not be public.
- Backfill current `approved = 1` rows to `technical_status = passed` and `identity_status = exact_provisional`; do not infer rights verification from the existing approval flag alone.
- Deploy in a controlled sequence: add fields and evidence records, verify/backfill covered rows, audit counts, then activate the fail-closed publication constraint and public-query filter in the same release.
- Change the UI/API contract from “three images required” to “one authentic primary image required; extra positions must be distinct views.”
- Add the candidate queue, reviewer audit trail, and synthetic-placeholder lane.

### Workstream B — close the 410 failed candidates (week 1)

- Re-run all failures through the latest validator only to confirm reproducibility.
- Recover the 50 failed consumer products first through exact ASIN partner assets and alternate provider gallery views.
- Send 282 mismatches directly to exact-source/physical-photo queues; do not tune the validator around them.
- Request original-resolution files for 87 exact low-resolution assets, subject to exact identity and verified rights.
- Reprocess the remaining 41 scene, cutout, blank, human, or other failures only when the original is exact and rights-verified; otherwise replace.
- Pilot on 20 medicines and all 18 no-source active consumer products before scaling.

### Workstream C — source the 1,400 products with no restorable gallery (weeks 1–4)

- Recover the 68 active consumer products through approved platform APIs before performing open-web discovery.
- Normalize manufacturer, MAH, and LTR names and create one request packet per organization.
- Recompute LTR coverage for the current 1,332-medicine backlog, then start with the top 10 and proceed to the next 15.
- In parallel, crawl only approved official manufacturer domains and ingest explicit licensed feeds.
- Obtain exact consumer images from brand owners or a permitted product-content feed for the 68 active consumer products. Use marketplace identifiers only as exact join or discovery keys.
- Route unresolved products to pharmacy/distributor capture sessions grouped by supplier and shelf location.

### Workstream D — refresh legacy provenance labels (weeks 1–4)

- Keep named-platform assets under their domain policies and the broader retained portfolio under its exact-asset registrations. Set `rights_verified = 1` only after deterministic evidence mapping, then remove stale “not independently verified” wording.
- Prioritize actual replacement only where an image fails identity, technical quality, or current-source checks.
- Replace by product. An existing image may remain live only if it is rights-verified and passes all other gates; otherwise serve the neutral placeholder until its replacement passes.
- Apply configured partner-source refresh, attribution, and takedown behaviour while preserving the per-image rights gate.
- Remove or quarantine an asset immediately if the exact variant is disproven, its source is withdrawn, or it fails technical validation.

### Workstream E — complete the customer experience (week 1 onward)

- Serve a consistent neutral “image pending verification” tile for products without an authentic image.
- Never show a broken `<img>` or recycle another product's packshot.
- Keep synthetic/category art visibly different from product photography and exclude it from image-quality or authentic-coverage metrics.
- Expose authentic-image status to operators, not as a misleading customer claim.

## Quality and release gates

The release dashboard must separately report:

- public active products;
- products with at least one authentic approved primary image;
- products using a labelled neutral placeholder;
- images pending rights verification;
- candidates pending identity review;
- expired rights;
- exact-identity rejections;
- broken public URLs;
- duplicate and non-distinct gallery views.

Required completion gates:

1. Every public product has a presentation state: authentic approved or labelled placeholder.
2. Every product-specific public image has `rights_verified = 1`, exact identity, technical approval, human approval, and immutable provenance.
3. Partner images are ingested through an approved named-partner or exact-asset portfolio policy and retain durable evidence mapping; other sources retain their documented authorization and provenance.
4. No synthetic asset is represented as actual packaging.
5. Every R2 object has a matching D1 row, checksum, MIME type, and approval receipt; every published D1 row resolves to a readable R2 object.
6. Browser QA passes at phone and desktop widths with zero broken images and no console errors.
7. A production readback report is signed off separately from local tests and deployment success.

## Delivery sequence and realistic timing

| Window | Deliverable |
|---|---|
| Days 1–3 | Completed: D1 `rights_verified` enforcement, broader portfolio correction, exact-asset authorization registry, restoration of all 7,929 retained rows, public Worker filters, and production readback. Next: finish the operator workflow for new acquisitions. |
| Days 4–7 | Exact partner-API recovery across the 68-product consumer backlog, 20-medicine controlled pilot, failure revalidation, and first recomputed LTR request packets. |
| Weeks 2–3 | Top-10 LTR campaign, official manufacturer/GS1 ingestion, first controlled photo sessions, replacement of highest-risk live marketplace sources. |
| Weeks 4–6 | Next-15 LTR campaign, long-tail manufacturer outreach, remaining photography, rights-review backlog. |
| Weeks 4–6+ | Long-tail source replacement for identity/quality failures and external non-responder escalation. |

The core rights platform and retained-image restoration are now live; the governed acquisition and review queues still require execution for 1,400 active products that have no retained gallery. The confirmed platform partnerships should materially accelerate the 68-product consumer backlog. Authentic 100% medicine coverage still depends on exact platform matches, rights-holder/local-representative responses, or physical pack photography. Visual completeness can reach 100% through a neutral labelled generated placeholder, but that must not be reported as 100% authentic product-image coverage.

Production evidence: Cloudflare D1 migrations `0009_product_image_rights_gate.sql` and `0010_expand_product_image_partner_portfolio.sql`; Worker artifact revision `966e60b9c603a98a694e461f66be8403d067f0f8`; Cloudflare Worker version `abe1a250-3ad4-4c9a-ba6b-f2748cb95ed9`; pre-`0010` Time Travel bookmark `00000007-00000915-000050d1-d8cdf3d981c9c2e42c881e819471d656`. Live readback returned 17,041 approved rights-verified rows, zero pending rights rows, zero invalid portfolio links, and HTTP 200 for the formerly hidden media route.

## External references

- Rwanda FDA registered-product register: https://www.rwandafda.gov.rw/register/monitoring_preview_register
- GS1 GDSN standards: https://www.gs1.org/standards/gdsn
- GS1 Product Image Sharing Guideline: https://www.gs1.org/standards/product-image-sharing-guideline/current-standard
- Amazon Associates IP licence and usage requirements: https://affiliate-program.amazon.com/help/operating/policies
- eBay Buy API requirements: https://developer.ebay.com/api-docs/buy/buy-requirements.html
- Walmart Marketplace API terms: https://developer.walmart.com/us-marketplace/page/terms-and-conditions
- OpenAI image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- Cloudflare R2 upload guidance: https://developers.cloudflare.com/r2/objects/upload-objects/
- Cloudflare R2 consistency: https://developers.cloudflare.com/r2/reference/consistency/

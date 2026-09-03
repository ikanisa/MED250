# Pharmacy GPS and contact research — production checkpoint

Latest verified production result: **checkpoint-008, 2 September 2026 at 19:52 Kigali (17:52 UTC)**. The 769-entry register contains **296 verified GPS locations** (93 original records preserved and 203 newly saved), **758 contact records**, and **198 entries with a source-verified public mobile number**. There are **473 entries without verified GPS** and **212 without any recorded contact**. All entries have a retained first-pass location observation or search, but 379 searches still await final identity review: full GPS/contact coverage is **not complete**.

The user-approved alternative sources, OpenStreetMap and official Rwanda GIS, are labeled separately from Google Maps. Public telephone evidence does not establish WhatsApp capability, ownership, consent or delivery. Existing active WhatsApp contact records cover 262 entries; this research has not verified that capability or activated recipients. The user subsequently approved a location-confirmation request to existing opted-in partners only. A fresh live preflight at 21:23 UTC found **zero recipient opt-ins**, so **no outreach messages were sent**. The 136 owner-attested initial permissions were not repurposed. See [the approved outreach preflight](whatsapp-remediation-2026-09-02/partner-location-outreach-preflight.md).

Current evidence: [complete 769-entry export](../../outputs/pharmacy-coordinates-2026-09-02/checkpoint-008-all-pharmacies.csv), [unresolved GPS worklist](../../outputs/pharmacy-coordinates-2026-09-02/checkpoint-008-unresolved.csv), and [production verification](../../outputs/pharmacy-coordinates-2026-09-02/checkpoint-008-verification.json). The numbered sections below retain historical results and superseding decisions.

## Historical checkpoints 001–003

Earlier result: **checkpoint-002, 2 September 2026 at 16:58 Kigali**. Its appended section records 167 verified locations; the first checkpoint below is retained as historical evidence.

Read-only revalidation: **checkpoint-003, 17:12 Kigali** confirmed the same production counts and all prior changes. No additional pharmacy was researched or updated in that continuation because Browser/Chrome/computer-control tools were unavailable in the session. A visible ambient Maps URL is not business-page verification. Browser-control reconnection is required to resume the requested one-by-one Codex web-view workflow. The tool/plugin discovery check did not expose an installable Browser or Chrome control connector.

Attachment reconciliation at **17:16 Kigali**: the user-supplied May 2026 PDF has SHA-256 `48170a4e7a058965e4dd5e1063c8248fa385dd7954970c9283a33e45d0629c98`, identical to the retained source. Text extraction of all 38 pages confirms serials 1–766 without gaps. All 766 retained retail-import entries match checkpoint-003 on registry key, name, province, district, sector/cell and licence expiry; the remaining three database entries are from the separate online register. The PDF has no business telephone, WhatsApp or GPS columns.

`attached-register-reconciliation.ipynb` preserves the executed checks; `attached-register-reconciliation.json` records the results. `attached-register-all-coverage.csv` covers all 769 entries and `attached-register-missing-gps-or-whatsapp.csv` includes entries lacking either field. These are research worklists, not dispatch approval: 602 entries lack verified GPS, 507 have no recorded active WhatsApp number and 481 have no active mobile contact. The 280 active WhatsApp contact rows belong to 262 distinct pharmacy entries, so contact-row counts must not be presented as pharmacy coverage. Public mobile and fixed phones remain separate. No new database records or permissions were changed. Google Maps opening was queued at the next unreviewed entry, PHARMACIE ELITE LTD, Gisenyi/Nengo, Rubavu; the page was not inspected because browser control remains unavailable.

Checked 2 September 2026, 15:46 Kigali time (13:46 UTC). This is a partial research checkpoint, not a full dispatch go-live approval.

## Checkpoint-001 production result — historical

| Measure | Verified result |
| --- | ---: |
| Register entries | 769 |
| Existing verified GPS records preserved unchanged | 93 |
| New GPS records saved and read back | 40 |
| Total verified GPS records | 133 |
| Entries checked one by one in the Codex Google Maps tab | 63 |
| Ambiguous/closed/conflicting listings held for review | 7 |
| Searches without an exact business match | 16 |
| Entries not yet reviewed in this pass | 613 |
| New public business-phone records | 28 |
| Of those, active source-verified business contacts | 19 |
| Of those, inactive research candidates | 9 |
| Total contact records, including retired/candidate records | 311 |
| Recorded active WhatsApp contacts | 280 |
| Contact-to-pharmacy associations corrected | 144 |
| Remaining ambiguous contact associations | 9 |

All 40 new coordinate updates, all 28 phone insertions, all 144 identity-link corrections, and their audit records passed a fresh remote readback. The prior 93 verified coordinate rows remained unchanged. All recorded WhatsApp contacts pass the full Rwanda mobile-number format check; all phone-only contacts pass the allocated mobile/fixed format check.

There are still **636 entries without verified GPS**: 613 not yet checked, 16 without an exact Maps match, and 7 held for review. The full register research is not finished.

## Number handling

Human-facing exports use full international notation, for example `+250788123456`, never `+2507xxxxx` or a shortened value. Existing internal matching retains the digits-only canonical value (`250788123456`) to avoid breaking identity lookups. Twilio transport formatting remains unchanged.

The validator follows [RURA's published allocation table](https://www.rura.rw/sectors/ict/sub-sectors-and-services/ict-spectrum-administration): mobile blocks 072, 073, 077, 078 and 079; fixed blocks 022, 023, 025 and 028. Fixed numbers are recorded only as phone contacts, not converted into mobile or WhatsApp contacts. Format validity does not establish an active line, business ownership, WhatsApp capability or recipient consent.

New Google Maps numbers are stored under `channel='phone'`. Conflicting or uncertain business associations are inactive candidates. A newly published number does not overwrite an older official-source contact, and a number already recorded for that business is not duplicated.

## Identity defect corrected

The legacy recovery builder attached December 2025 source serials directly to May 2026 registry row IDs. Row numbers had shifted, so this associated some numbers with the wrong business. For example, VAN's source number had been attached to NASSA, and Pharmacie de Butare's source number had been attached to VAN.

A strict source-name, district, sector, cell and register-crosswalk review supported 144 corrections. The current contact and known-number binding were updated together. No existing login actor or consumed permission was rebound. The associated 144 unclaimed, wrongly scoped initial permissions were revoked; their history was retained. Corrected contacts have login and dispatch disabled and were not granted new WhatsApp verification or consent.

The legacy v2 recovery CLI `apply` path is now blocked, with a regression test, to prevent reintroducing the row-number defect or overwriting reviewed GPS evidence. Its historical build and read-only verification remain available.

Nine source associations still require manual identity review. Their pharmacy-level dispatch flags are all disabled, including where a location has now been verified. They must not become routable merely because GPS has been found.

## GPS evidence and exclusions

Each new pin was inspected individually in Google Maps in the **Codex web view**. The exact business-place latitude/longitude was taken from the place URL, never from the map viewport centre or a search-area centre. The name and branch locality were reviewed, with public phone information where available.

Every promoted point also passed an exact district and sector point-in-polygon comparison against the [Rwanda Ministry of Environment administrative boundary service](https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/1), based on the 2022 census. This corroborates district/sector, not cell boundaries, present business operation, phone ownership or consent.

Examples held out of routing:

- Stream: more than one register branch in the same locality; branch identity unresolved.
- Aurore: two nearby candidate business pins.
- El-Shadai and Adonis: actual listing locality conflicts with the registered locality.
- Shema: listing marked permanently closed.
- Karo: competing listings; the inspected pin is outside the registered sector.
- Holi: initially held because the published business type differed from the registered retail branch. This hold was resolved at checkpoint-008 using exact registered-cell and independent contact corroboration; the historical decision is retained.

Candidate pins are preserved in the evidence and exported into explicitly labelled `candidate_*_not_for_routing` columns. They do not populate canonical routing coordinates.

## Dispatch boundary

The database currently has **23 configured mapped destinations**, down from 36 after the mislinked identities were disabled. This is a configuration count, not proof of delivery, WhatsApp ownership, recipient opt-in, or a complete eligible network.

No new coordinate or phone record was automatically activated for dispatch. No WhatsApp messages were sent by this research. The historical outbox remains at 48 rows. There are 136 unrevoked initial permissions and 144 revoked misbound permissions. Recurring opt-in is separate from an owner's initial-outreach attestation.

Before activation, resolve the remaining identity conflicts, verify the correctly scoped recipient permission/opt-in, and perform a controlled nearest-10 routing and delivery/readback check. Do not reuse the revoked grants or present map/phone verification as WhatsApp delivery verification.

## Evidence and validation

Local evidence directory: `outputs/pharmacy-coordinates-2026-09-02/`.

- `checkpoint-001-all-pharmacies.csv`: complete 769-entry register with international-format numbers, canonical GPS, research state, candidate pins and source links.
- `checkpoint-001-unresolved.csv`: the 636 entries still without verified GPS.
- `checkpoint-001-verification.json`: fresh remote reconciliation and exact counts.
- `before.json` and `contact-repair-before.json`: immutable pre-change evidence.
- `observations/`, `phone-observations/`, `boundary-checks/`, `boundary-resolutions/`: individual evidence and append-only decisions.
- `batch-001` through `batch-007`: SHA-bound coordinate plans, D1 recovery bookmarks, apply output and remote readbacks.
- `phones-001` through `phones-005`: phone insertion plans, bookmarks and readbacks.
- `contact-association-repair-*`: reviewed identity correction manifest and readback.

Twenty-four focused tests passed, covering exact place-coordinate extraction, Rwanda number handling, immutable verified points, closed-listing exclusion, candidate/report separation, crosswalk identity guards, no implicit consent, and legacy recovery replay prevention. Generated mutation SQL was also exercised against the real strict D1 schema locally. No staging deployment was used.

This work changed production D1 data and local research/safety scripts. It did not redeploy the Worker, push Git, modify secrets, use Supabase/Neon, or send messages. Unrelated pre-existing worktree changes were preserved.

## Continue safely

Use the unresolved export as the remaining queue and match by exact registry key/name/locality, never by legacy row position. Keep checking Maps one business at a time. Retain unclear results as candidates, and apply only source-reviewed, boundary-matched coordinates with a fresh plan, recovery bookmark and remote readback. Export a new numbered checkpoint after the next verified batch; never overwrite earlier evidence.

## Checkpoint-002 — 16:58 Kigali, 2 September 2026

A further 49 register entries were inspected individually in the same Codex Google Maps tab. Production batches `batch-008` through `batch-010` added 34 boundary-matched GPS records; `phones-006` through `phones-008` added 28 phone-only contacts (18 source-verified business contacts and 10 inactive candidates). Each batch was SHA-bound, bookmarked before mutation and independently read back. No previously verified point was overwritten.

| Measure | Current verified result |
| --- | ---: |
| Register entries | 769 |
| Original verified GPS rows preserved | 93 |
| Cumulative new GPS records saved | 74 |
| Total verified GPS records | 167 |
| Entries individually researched in this pass | 112 |
| Ambiguous/closed/conflicting listings held | 19 |
| Searches without an exact business match | 19 |
| Entries not yet researched | 564 |
| Entries still without verified GPS | 602 |
| Cumulative new phone-only contacts | 56 |
| Source-verified active business phones | 37 |
| Inactive phone candidates | 19 |
| Total contact records | 339 |

The latest complete export is `outputs/pharmacy-coordinates-2026-09-02/checkpoint-002-all-pharmacies.csv`; the remaining queue is `checkpoint-002-unresolved.csv`. `checkpoint-002-verification.json` confirms all 74 GPS changes, all 56 phone insertions, all 144 previous association repairs, and the unchanged original 93 coordinate records against fresh remote D1 data. No verified observation remains unapplied. All contact numbers pass the applicable complete Rwanda format check. The 24 focused tests passed again, and `git diff --check` was clean.

Additional exclusions include Atone (permanently closed), the shared Semu/Semu Branch listing (branch attribution unresolved), Gratis (Nyamirama pin versus registered Mukarange), Du Progres (Gikondo pin versus registered Kigarama), Ihirwe (Gisozi versus Rwezamenyo), and La Licorne (Nyamirambo versus Kimisagara, sharing an exact pin with other unrelated candidates). Retail/wholesale or other business-category discrepancies remain candidates until corroborated. These are research findings, not licence determinations or definitive statements about current business operation.

There are still 23 configured mapped dispatch destinations, 48 historical outbox rows, 136 unrevoked initial permissions and 144 revoked misbound permissions. This pass created no WhatsApp identity, recipient permission, dispatch activation or outbound message. Finding a phone number and GPS pin does not establish WhatsApp ownership or opt-in. No Worker redeployment, Git push, secret changes, Supabase or Neon usage occurred.

The full register research remains incomplete. Continue from the 564 unreviewed entries, and investigate the 38 held/no-match entries separately. Preserve the numbered checkpoints and the candidate-versus-routing distinction.

## Checkpoint-004 — 17:32 Kigali, 2 September 2026

The Codex Maps browser and Chrome extension were both used in this continuation. Desktop Computer Use could not control the protected Codex app; no attempt was made to bypass that restriction. The dedicated browser controls remained available, and Maps was left open on the verified Pulse Pharmacy place page.

Twenty-seven additional register entries were inspected individually in Maps. The [Ubipharm Rwanda public pharmacy directory](https://rwanda.ubipharm.com/en/Spec-annulist,AnnuairePharmacies) was also inspected through Chrome: all **34 pages / 662 visible business entries** were retained as immutable, SHA-256-backed source evidence. This source inventory is not a claim that all 662 entries match the current FDA register or have verified coordinates.

Production changes in this continuation:

- `phones-009`: 97 new phone-only records, of which 48 are source-verified business contacts and 49 are inactive candidates.
- `phones-010`: one additional inactive PFG phone candidate; the number conflicts with another registered pharmacy contact.
- Together, **98 new contact records: 48 active business-phone records and 50 inactive candidates**. Ninety-five came from individually reviewed directory entries and three from Maps. All are complete Rwanda mobile numbers, exported as `+2507XXXXXXXX`.
- `batch-011`: Pulse Pharmacy Shyorongi's exact business pin, **-1.8602368, 29.9784206**, was saved after the name, branch locality, independent directory entry, and official Rulindo/Shyorongi boundary result agreed.
- Every mutation had a reviewed SHA-bound plan, a D1 recovery bookmark and successful remote readback. No existing contact or verified coordinate was overwritten by these batches.

The directory path preserves its own source label and entry text; it never describes directory evidence as Google Maps evidence. Name normalization only accommodates case, punctuation and legal company suffixes; branch names remain significant. An exact registered name and district are required before recording a directory contact. In this pass, inadequate branch evidence, locality contradictions and shared-number conflicts were held inactive. Published telephone details are **not** proof of WhatsApp subscription, ownership, opt-in or current reachability.

| Measure | Live readback |
| --- | ---: |
| Register entries | 769 |
| Verified GPS records | 168 |
| Original verified GPS rows preserved | 93 |
| Cumulative new GPS records | 75 |
| Cumulative individually inspected Maps entries | 139 |
| Ambiguous/conflicting Maps entries held | 22 |
| Inspected searches without an exact match | 42 |
| Entries not yet inspected individually in Maps | 537 |
| Entries still without verified GPS | 601 |
| Total contact records, including inactive candidates | 437 |
| Cumulative new phone-only contacts | 154 |
| Of those: active business phone / inactive candidate | 85 / 69 |

New GPS exclusions include Taqwa (Maps pin is in Mayange, while the register specifies Nyamata), Amizero (register spelling `NIBOYI` versus official `Niboye`, held for a documented locality-name resolution), and PFG (candidate pin does not establish the registered Rusororo branch). Elite remains without an exact map match. Similar names and map viewport coordinates were not used as replacements. The Open Pharmacy search initially inferred an opening-hours filter; it was explicitly cleared and unrestricted-hours results were inspected before recording the unresolved search.

Evidence:

- `outputs/pharmacy-coordinates-2026-09-02/checkpoint-004-all-pharmacies.csv`: all 769 entries, complete phone numbers, canonical GPS and candidate/source distinctions.
- `checkpoint-004-unresolved.csv`: the 601 unresolved GPS entries.
- `checkpoint-004-verification.json`: fresh production reconciliation, including all 75 coordinate updates, 154 phone additions, the earlier 144 association repairs and preservation of the original 93 verified locations.
- `directory-pages/ubipharm-01` through `ubipharm-34`: captured visible entries and source hashes.
- `phones-009`, `phones-010` and `batch-011`: plans, recovery bookmarks, apply output and readbacks.

Twenty-seven focused tests passed, including new directory provenance, exact-name/branch/locality guards, malformed or cross-field phone rejection and unchanged WhatsApp boundaries. Directory source text and hashes were reconciled to the 95 reviewed directory additions before import; all 98 new records were read back. JavaScript syntax and `git diff --check` passed.

No WhatsApp identities, login permissions, recipient permissions, dispatch activations or messages were created. Configured mapped destinations remain 23 (not delivery-verified), the historical outbox remains 48 rows, and initial permissions remain 136 unrevoked / 144 revoked. There was no Worker deployment, Git push, secret change, Supabase or Neon use. All-register GPS and WhatsApp verification remain incomplete; continue the 537 uninspected Maps entries and separately investigate the 64 held/no-match entries. Raw directory entries that failed the strict match or number-format rules remain evidence only, not imported contacts.

## Checkpoint 005 — approved alternative sources and wider register research

Fresh production reconciliation: **2026-09-02 17:00 UTC**. This supersedes the counts above, not their retained evidence. The user explicitly approved source-labeled OpenStreetMap and official Rwanda GIS coordinates for entries not resolved in Google Maps.

| Measure | Verified production readback |
| --- | ---: |
| Register entries (766 retail, 3 online) | 769 |
| Verified GPS records | 258 |
| Original verified GPS rows preserved without changes | 93 |
| Cumulative new GPS records and matching audit events | 165 |
| Entries still without verified GPS | 511 |
| Total contact records, including inactive candidates | 604 |
| Cumulative new phone-only records | 321 |
| New active business-phone records / inactive candidates | 191 / 130 |
| Entries with a verified public mobile | 178 |
| Entries with recorded active WhatsApp contacts, not capability-verified by this research | 262 |
| Entries without any recorded contact | 295 |
| Recorded searches awaiting final identity review | 135 |
| Entries without an individual location observation/search yet | 295 |

Since checkpoint 004, `batch-012` through `batch-017` added 90 GPS records; `phones-011` through `phones-018` added 167 phone-only contacts. All mutations used reviewed hash-bound plans, recovery bookmarks and successful readbacks. Forty-five new points are attributed to OpenStreetMap, three to the official Rwanda pharmacy GIS, and the other new points to individually inspected Google Maps listings. Alternative-source records do not claim a Google place URL or activate dispatch.

Source controls and findings:

- The public OSM snapshot contains 588 pharmacy-tagged point features. Exact named business identity, unique branch, Rwanda administrative boundaries, closure and overlapping-pin checks gate import. Border-country points, shared generic pins, ambiguous branches and malformed phone tags are not accepted. OSM attribution and ODbL provenance are retained per record.
- The official Rwanda pharmacy GIS contains 291 point features and no populated business-phone fields. Its older survey/edit dates are retained explicitly. Only three exact, positive-accuracy, current-register-correlated Nyamata business points cleared review; older GIS coordinates do not override evidence of possible relocation.
- All 11 July–September 2026 Rwanda FDA duty-roster PDFs were fetched again from the official source and matched their retained SHA-256 values. Table headers and complete pages were checked; phone cells remain tied to the same pharmacy/location row. This corrected an old Teta branch mapping rather than trusting historical register serial numbers. Missing digits were not invented.
- Mission's `RUBACU`/Rubavu and Unique Kimihurura's `KIMUHURURA`/Kimihurura discrepancies were resolved using the current FDA roster's exact branch, cell and official boundary. The raw register spellings and original failed literal comparisons are preserved. Amizero's different spelling issue remains held without equivalent corroboration.
- Six separately named Goodlife branches cleared registered-sector review. Town/Town II, Musanze and Rubavu ambiguities remain held. Shared head-office numbers are not assigned to every branch. A public telephone, or even a published WhatsApp link, does not prove ownership, reachability, opt-in or delivery.

The export now counts retained searches separately from verified coordinates and final identity decisions. A failed load is not a completed search, a search is not a verified business match, and completing a first pass is not completing GPS/contact coverage. A crashed in-app Maps research tab was not treated as evidence; work continued in the already-authorized Chrome browser.

Evidence: `checkpoint-005-all-pharmacies.csv`, `checkpoint-005-unresolved.csv`, `checkpoint-005-verification.json`, `search-attempts/`, `openstreetmap/`, `osm-observations/`, `government-gis/`, `gis-observations/`, `fda-roster-tables-v2.json`, `fda-roster-live-source-check.json` and the named batch plans/readbacks under `outputs/pharmacy-coordinates-2026-09-02/`.

Forty-three focused tests passed before this checkpoint. All 144 prior association corrections and all 321 phone additions were reconciled again. There were zero invalid stored Rwanda phone formats. Historical outbox rows remain 48; permissions remain 136 unrevoked and 144 revoked. No messages, WhatsApp identities, login permissions, recipient permissions or dispatch activations were created. No deployment, Git push, secret change, Supabase or Neon use occurred. **All-register GPS/contact research and WhatsApp capability verification remain incomplete; the wider individual search continues.**

## Checkpoint 006 — complete first search pass, not complete GPS coverage

Fresh remote reconciliation at **2026-09-02 17:36 UTC** verified `batch-018` (25 additional GPS records) and `phones-019` (16 additional public phone records: 13 active business contacts, three inactive candidates). Production now contains **283 verified GPS records and 620 contact records** across the 769 register entries. All original 93 GPS records, 190 new GPS/audit pairs, 337 new phone records and 144 earlier association repairs were read back successfully.

Every register entry now has a prior verified point, retained individual observation or retained location search. The last 375-entry Google Maps search pass is saved in `maps-pass-001-captures.json`, SHA-256 `cedc8f0dd2c9a7d62c345543bcf0e307e543823a6ae91ec83e3785ffddc3c8b3`. Search coverage is not business identity verification: **486 entries still lack verified GPS**, 396 searches await final identity review, and 285 entries have no recorded contact. There are 189 entries with a verified public mobile and 262 entries with previously recorded active WhatsApp contacts; this research does not establish WhatsApp capability or consent.

The latest batch separates the Goodlife H&B Musanze branch from Good Life Pharmacy in a different Musanze sector. Conseil's official website confirmed separate Kacyiru and Nyarutarama contacts; the Kacyiru Maps page displays the downtown branch's number, so that conflicting number was not promoted as its verified contact. Wrong-district, closed and unresolved branch results are explicitly retained under `supplemental-holds/` and remain excluded from routing. Google viewport centres, missing pin coordinates, similar business names and missing phone digits are not substituted for evidence.

The current exports are `checkpoint-006-all-pharmacies.csv` and `checkpoint-006-unresolved.csv`; `checkpoint-006-verification.json` contains the independent production reconciliation. Forty-six focused tests passed. Zero invalid phone formats, zero new WhatsApp identities, zero dispatch activations and zero outbound messages were recorded. Configured mapped destinations remain 23, historical outbox rows 48 and permission counts 136 unrevoked / 144 revoked. No Worker deployment, Git push, secret change, Supabase or Neon use occurred. Continue reviewing the retained leads and alternate-source matches; full GPS/contact coverage is not complete.

## Checkpoint 007 — cell-level review and additional public contact sources

At **2026-09-02 17:48 UTC**, remote D1 readback verified **294 GPS records and 757 contact records**. `batch-019` and `batch-020` added 11 GPS points. `phones-020` added 122 phone records (four verified business contacts, 118 inactive candidates); `phones-021` added 15 (seven verified business contacts, eight inactive candidates).

The [official Ministry of Environment cell-boundary layer](https://moegis.environment.gov.rw/server/rest/services/Hosted/Administrative_boundaries/FeatureServer/2) was used for finer branch checks. Exact named pins for Rite Nyarutarama, Rite Sana, Muhire Nyarugunga, Goodlife 15, Pareke, QL, Sainte Thérèse, Medigate and High Magnificat Mpenge agree with their registered cells. Apothecary's Kabuga I pin is distinguished from the Masaka/Cyimo branch. The High Magnificat Cyuve listing is not the Goico branch. The same point is never assigned to two branches merely because they share a company name or head-office phone.

Alamanda HQs passed the broader sector check but failed the registered-cell comparison (Karugira versus Nyenyeri). Its preliminary local decision was explicitly reconsidered before import; **no Alamanda GPS update was applied**. This supersedes the intermediate progress description identifying it with the Kigarama entry. Belle Toile/Belle Etoile and Urukundo also remain held. A research-note error describing Medigate as Rwamagana was corrected against the actual current row, Kicukiro/Gatenga/Karambo; its exact point subsequently passed both sector and cell checks. Original notes and superseding decisions are retained rather than silently erased.

All 34 Ubipharm pages were revisited from retained source evidence. Another 116 exact-name Kigali phone leads were saved **only as inactive candidates**: a city-level address or differing locality is not branch verification. Complete numbers were preserved without inventing digits or replacing existing contacts. The new [Healthflix pharmacy directory](https://healthflix.rw/category/pharmacies/) yielded 35 individually opened public business pages; source name, own phone field, location description, timestamp and SHA-256 are retained. Its verification badges are not treated as WhatsApp capability or consent. No-match current-register identities, vague landmarks and conflicting branches remain evidence only or inactive candidates. The directory's header contacts and unrelated recommended businesses are not attributed to the selected pharmacy.

Phone-only Maps searches were tested, including a known mapped control business; they did not locate even the control reliably. The work therefore moved to indexed search, exact observed place links, business directories and official boundary checks. Nearby clinics, markets and buildings were not substituted for pharmacy premises. Chrome remained usable after two slow business-site tabs; those eventually loaded, and no protected Computer Use or crashed in-app-tab restriction was bypassed.

The checkpoint preserves all original 93 GPS rows and reconciles all 201 new coordinate updates, 474 phone insertions and 144 association corrections. There are 197 entries with a source-verified public mobile, 212 with no recorded contact, and 475 without verified GPS. Forty-eight focused tests passed. The complete first location-search pass is recorded separately from incomplete GPS/contact coverage. No outbound message, WhatsApp identity, login enablement or dispatch activation was created. Partner location-confirmation outreach has been proposed for approval; **it has not been sent**.

## Checkpoint 008 — latest verified production and full-register handoff

Remote reconciliation completed at **2026-09-02T17:52:05.260Z**. `batch-021` added two verified GPS records, Holi (register key 255) and Vita-Pharma (key 48). Their exact Google Maps business points agree with the registered Jabana/Kabuye and Kanombe/Kabeza cells respectively; independent directory contact evidence corroborated identity. Holi's earlier category-only hold was explicitly resolved, not silently removed. `phones-022` added Vita-Pharma's public mobile `+250796338980` as a business-phone contact, not a WhatsApp identity. Lucky Fam remains excluded because its point is in Barija rather than its registered Nyagatare cell.

| Measure | Latest production readback |
| --- | ---: |
| Register entries | 769 |
| Verified GPS locations | 296 |
| Original verified GPS rows preserved unchanged | 93 |
| New GPS updates and matching audit records | 203 |
| Entries without verified GPS | 473 |
| Total contact records, including inactive candidates | 758 |
| New public phone-only records | 475 |
| New active business-phone records / inactive candidates | 216 / 259 |
| Entries with a source-verified public mobile | 198 |
| Entries with previously recorded active WhatsApp contacts | 262 |
| Entries without any recorded contact | 212 |
| Retained searches awaiting final identity review | 379 |
| Verified coordinate observations not yet applied | 0 |
| Invalid recorded phone formats | 0 |

All 203 new coordinate updates, 475 phone insertions and 144 earlier association repairs were reconciled against production. All original 93 verified GPS records remain unchanged. The final two plans were hash-bound, recovery-bookmarked and read back successfully. Forty-eight focused tests passed; all pharmacy research scripts passed syntax checks and `git diff --check` was clean.

The latest complete export is `outputs/pharmacy-coordinates-2026-09-02/checkpoint-008-all-pharmacies.csv`; the outstanding queue is `checkpoint-008-unresolved.csv`. `checkpoint-008-summary.json`, `checkpoint-008.json` and `checkpoint-008-verification.json` distinguish first-pass search coverage, actual verified coordinates, public contact evidence and unresolved identity decisions. Complete mobile numbers are exported in international `+2507XXXXXXXX` format. A candidate number already recorded is not automatically promoted merely because a location is later resolved.

This is a partial production data-enrichment result, **not full GPS/WhatsApp coverage or dispatch go-live approval**. Public-source research is not claimed to be exhausted. Partner location-confirmation outreach remains awaiting approval and has not been sent. Configured mapped destinations remain 23, not delivery-verified; historical outbox rows remain 48; permissions remain 136 unrevoked and 144 revoked. No WhatsApp identity, recipient permission, login enablement, dispatch activation, outgoing message, Worker deployment, Git push or secret change was made. No Supabase or Neon service was used.

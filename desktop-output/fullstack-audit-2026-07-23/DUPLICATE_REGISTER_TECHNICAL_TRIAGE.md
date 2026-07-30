# MED+250 Duplicate Register Technical Triage

Date: 2026-07-23

Classification: Technical comparison only — not a regulatory decision or launch approval

## Outcome

All 51 duplicate-identifier groups remain correctly blocked for review by a named register data reviewer. The source rows are not exact duplicates, so automated deduplication, silent row deletion, or a blanket `accepted_source_duplicate` decision would be unsafe.

The authoritative comparison packet is:

`desktop-output/goal-progress-2026-07-20/duplicate-register-review-packet-2026-07-20.json`

The governed decision ledger remains:

`data/imports/duplicate-register-review.csv`

## Technical risk split

| Cohort | Groups | Technical finding | Required owner action |
|---|---:|---|---|
| Product registration | 6 | Every pair differs in meaningful product identity fields. None is an exact duplicate. | Rwanda FDA/register reviewer must identify the authoritative row or confirm that the identifier legitimately covers both products. |
| Pharmacy professional registration, same token-set technician name | 32 | The same apparent professional is associated with multiple premises, often with different geography or licence dates. This may reflect movement, multiple appointments, or stale source data. | Confirm whether concurrent/multiple premises are valid for the professional and effective dates. |
| Pharmacy professional registration, differing or variant technician name | 13 | The source uses materially different names or spelling variants under one professional identifier. | Resolve against the authoritative professional register before acceptance. |

Ten of the 13 differing-name groups have clearly different people, or include at least one clearly different person, and should be treated as the highest-priority correction checks:

`NPC/A0080`, `NPC/A0189`, `NPC/A0426`, `NPC/A0569`, `NPC/A0617`, `NPC/A0883`, `NPC/A0976`, `NPC/A1191`, `NPC/A1214`, `NPC/A1384`.

The other three are plausible formatting or spelling variants but still require authority confirmation:

`NPC/A0966`, `NPC/A1287`, `NPC/A1348`.

## Product registration conflicts

| Identifier | Source references | Material conflict |
|---|---|---|
| `RWANDA FDA-HMP-MA-1188` | `product:1278`; `product:1289` | Generic, strength, pack, shelf life, manufacturer and country differ. |
| `RWANDA FDA-HMP-MA-1539` | `product:1469`; `product:997` | Generic, strength, pack, shelf life, registration date and expiry differ. |
| `RWANDA FDA-HMP-MA-1566` | `product:827`; `product:910` | Brand, generic, strength, form, pack and manufacturer differ. |
| `RWANDA FDA-HMP-MA-1853` | `product:811`; `product:915` | Brand, generic, strength, form, pack and manufacturer differ. |
| `RWANDA FDA-HMP-MA-1915` | `product:592`; `product:813` | Brand, generic, strength, pack and manufacturer differ. |
| `RWANDA FDA-HMP-MA-2086` | `product:710`; `product:773` | Different therapies: sitagliptin/metformin versus levodopa/carbidopa, with different manufacturers and pack details. |

## Decision rule

The reviewer must record exactly one governed outcome for every group:

- `accepted_source_duplicate` only when the authoritative source confirms distinct valid records sharing the identifier.
- `blocked_source_correction` when authoritative clarification or correction is still required.

Each non-pending row also requires the real reviewer name, a timezone-qualified timestamp, and a substantive rationale. Codex has not inserted review decisions or represented itself as the human/register authority.

Strict verification remains:

```bash
npm run data:duplicates:verify -- --strict
```

It should pass only after all 51 decisions are completed and none remains blocked.

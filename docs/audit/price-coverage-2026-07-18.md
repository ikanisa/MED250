# MED+250 indicative-price coverage report

Report date: 2026-07-18  
Research snapshot: 2026-07-15  
Status: **technical evidence complete; product/data-owner approval pending**

This artifact is reproducible with:

```sh
npm run data:price-coverage -- --as-of 2026-07-18
```

## Summary

| Measure | Evidence |
| --- | ---: |
| Approved catalogue rows assessed | 4,680 |
| Products with central indicative price | 128 |
| Overall catalogue coverage | 2.74% |
| Medicine products with price | 0 |
| Consumer products with price | 128 |
| Unsafe/incomplete price metadata | 0 |
| Amazon-derived public prices | 0 |

The numerical target of 100 priced products is met. This does **not** close Goal 3: the current set has 0 medicine prices, is not yet an owner-approved priority set, and still requires source-reuse, freshness, and correction-process approval.

## Coverage by department

| Department | Priced products |
| --- | ---: |
| Beauty & Personal Care | 50 |
| Health & Household | 46 |
| Baby | 32 |

## Evidence sources

| Rwanda source | Priced products |
| --- | ---: |
| Kasha Rwanda live product API | 118 |
| Kigali Protein Store | 10 |

## Observation age at report date

| Evidence age | Priced products |
| --- | ---: |
| 0–30 days | 128 |

Oldest observation: 2026-07-15T00:00:00+02:00  
Newest observation: 2026-07-15T00:00:00+02:00

## Price distribution

Minimum RWF 800; median RWF 5,000; maximum RWF 195,000.

These values are central, informational references. They are not pharmacy-specific stock, a pharmacy price list, or a final customer charge.

## Required owner decisions

1. Approve or replace the candidate priority-product set, including medicine representation.
2. Approve publication/reuse rights for every price source.
3. Set the maximum permitted evidence age and the refresh/expiry schedule.
4. Name the reviewer and correction/withdrawal owner.
5. Re-run this report against the approved live catalogue and attach deployed product samples before closing Goal 3.

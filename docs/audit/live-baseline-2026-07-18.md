# MED+250 live baseline

Browser capture: 2026-07-18 09:54–10:00 CAT (Africa/Kigali)  
Machine-verification refresh: 2026-07-18 11:48 CAT (Africa/Kigali)  
Target: `https://med250.gikundiro.com`  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`  
Local repository commit at capture: `f2bd1341ee40733c106ba347654e92c5d35207c5` (dirty worktree; not asserted as the deployed revision)

## Outcome

The live storefront no longer exhibits the audit's apparent 24-product ceiling. The browser loaded 168 stable product cards on the homepage, retained an accessible manual load control, and exposed late-alphabet products beyond the first server page. The sampled Beauty & Personal Care, Baby, and Health & Household department routes were populated.

This is a partial Goal 0 baseline, not launch approval. The live Worker now exposes the stable release value `manual-20260718-d0e0a582b819`, and an exact-value verification pass is retained as a dated receipt. That value does not resolve to a commit in this repository, so it is deployment identity evidence but not yet immutable source-to-production traceability. Every protected production evidence gate remains pending.

## Machine checks

| Check | Result |
| --- | --- |
| `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision manual-20260718-d0e0a582b819` | Passed against all 10 required routes with an exact release-value match |
| `/sitemap.xml` | 4,665 `<url>` entries |
| `robots.txt` | Public routes allowed; `/pharmacies` and pharmacy-portal query URLs disallowed; sitemap and host use the production origin |
| Security headers | CSP, request ID, server timing, and other verifier-controlled headers present |
| Deployment release value | `manual-20260718-d0e0a582b819`; stable across the discovery and exact-match probes, but not found in local Git history |
| Durable receipt | [10-deployment-verification.json](live-baseline-2026-07-18/10-deployment-verification.json): allowlisted headers, response byte counts and SHA-256 digests, verifier digest, no response bodies |
| Full live catalogue | [Source-bound catalogue report](live-catalogue-readiness-2026-07-18.md): all 39 pages and every advertised department are reachable without duplicate IDs; production still has two retired records and two multilingual search failures |

The protected Cloudflare workflow injects the exact Git commit SHA as `MED250_RELEASE_REVISION`; the Worker returns it as `X-MED250-Release-Revision`. The verifier now fails when that header is absent, malformed, or differs from an optional `--expected-revision`, and can atomically write a body-free receipt through `--evidence-output`. A governed deployment receipt or an immutable commit value is still required to reconcile the current manual release value to source.

## Browser evidence

The browser session used the live custom domain. Counts below come from the settled DOM after loading ended (`aria-busy=false`), not from loading skeletons.

| Route | Settled evidence |
| --- | --- |
| `/` | 168 product cards; progress announced `168 shown`; manual control announced `More products are available` / `Load more products`; late visible titles included `Agopred-10 tablets`, `Agopril tablets`, and `Agoscab` |
| `/category/personal-care` | 24 product cards; department title `Beauty & Personal Care`; no empty state |
| `/category/baby` | 24 product cards; department title `Baby`; no empty state |
| `/category/wellness` | 24 product cards; document title `Health and household products | MED+250`; no empty state |

Accepted screenshots:

- [Homepage pagination beyond 24](live-baseline-2026-07-18/04-home-pagination-beyond-24-stable.png)
- [Beauty & Personal Care populated](live-baseline-2026-07-18/06-personal-care-populated-stable.png)
- [Baby populated](live-baseline-2026-07-18/08-baby-populated-stable.png)
- [Health & Household populated](live-baseline-2026-07-18/09-wellness-populated.png)

The earlier `03`, `05`, and `07` captures contain loading skeletons and are retained only as transient-state diagnostics. They are not accepted as completion evidence.

## Remaining Goal 0 closure

1. Reconcile `manual-20260718-d0e0a582b819` to a governed deployment receipt or replace it through the protected workflow with the exact deployed Git SHA, then retain an exact-match verification receipt.
2. Capture mobile evidence and the complete request basket/status journey with approved controlled identities.
3. Deploy the multilingual search normalization, prove its two currently failing common-use queries, and capture controlled catalogue failure/retry behavior.
4. Retire the two identified non-product rows so the live 4,659-row catalogue reconciles exactly to the governed 4,657-row source, then reconcile price, backend-contract, and operational counts.
5. Close the 15 named legal, operational, security, infrastructure, and physical-device gates; no local implementation or public reachability substitutes for those approvals.

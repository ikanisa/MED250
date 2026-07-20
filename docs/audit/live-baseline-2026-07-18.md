# MED+250 live baseline

Browser capture: 2026-07-18 09:54–10:00 CAT (Africa/Kigali)  
Machine-verification refresh: 2026-07-18 16:53 CAT (Africa/Kigali)
Target: `https://med250.gikundiro.com`  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`  
Verified production release revision: `5ef50a296941056bd17e614dff7b35290742f50a`

## Outcome

The live storefront no longer exhibits the audit's apparent 24-product ceiling. The browser loaded 168 stable product cards on the homepage, retained an accessible manual load control, and exposed late-alphabet products beyond the first server page. The sampled Beauty & Personal Care, Baby, and Health & Household department routes were populated.

This remains a partial Goal 0 baseline, not launch approval. The live Worker exposes the exact lowercase Git revision above, and the dated deployment receipt proves the expected and observed values match across all 10 required routes. The source-bound catalogue receipt independently passes at exactly 4,657 products. All 16 governed browser scenarios now pass with 56 immutable captures; the ledger remains pending overall because independent approval has not been recorded.

## Machine checks

| Check | Result |
| --- | --- |
| `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision 5ef50a296941056bd17e614dff7b35290742f50a` | Passed against all 10 required routes with an exact Git-revision match |
| `/sitemap.xml` | 4,665 `<url>` entries |
| `robots.txt` | Public routes allowed; `/pharmacies` and pharmacy-portal query URLs disallowed; sitemap and host use the production origin |
| Security headers | CSP, request ID, server timing, and other verifier-controlled headers present |
| Deployment release value | `5ef50a296941056bd17e614dff7b35290742f50a`; expected and observed values match exactly |
| Durable receipt | [14-deployment-verification-5ef50a.json](live-baseline-2026-07-18/14-deployment-verification-5ef50a.json): allowlisted headers, response byte counts and SHA-256 digests, verifier digest, no response bodies |
| Full live catalogue | [Source-bound catalogue report](live-catalogue-readiness-2026-07-18.md): all 39 pages reconcile to 4,657 governed IDs; every advertised department and all six required search cases pass |

The protected Cloudflare workflow injects the exact Git commit SHA as `MED250_RELEASE_REVISION`; the Worker returns it as `X-MED250-Release-Revision`. The verifier fails when that header is absent, malformed, or differs from `--expected-revision`, and atomically retained the body-free passing receipt linked above.

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

The newer source-bound [browser evidence ledger](../../data/audit-browser-evidence.json) supersedes those samples for P0 verification. It validates immutable PNG digests for all 16 production scenarios and 56 required captures across desktop and mobile. The controlled run is complete and bound to the passing deployment and catalogue receipts; independent approval remains pending, so the ledger's overall status remains `pending` with `execution_status: completed_awaiting_approval`.

## Remaining Goal 0 closure

1. Obtain independent QA review and record the real approver name, role, and timestamp before promoting the browser ledger to `passed`.
2. Reconcile price, backend-contract, operational, legal, security, infrastructure, and physical-device gates; machine checks and public reachability do not substitute for those approvals.

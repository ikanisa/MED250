# MED+250 Full-Stack Production Readiness Audit — Pre-optimization Snapshot

Audit date: 23 July 2026

Repository: `https://github.com/ikanisa/MED250`

Reviewed revision: `20a7f703ac07a8d3e12dd87f15599eccdd21903b`

Live target: `https://med250.gikundiro.com`

Verdict: **NO-GO for production release**

## Executive conclusion

The repository is locally synchronized with `origin/main`, the application
builds, Cloudflare's strict production dry-run succeeds, the live public
website is reachable and responsive, and the primary desktop/mobile
marketplace interaction works without browser console errors.

Those positives do not overcome the release blockers. The live website serves
revision `37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c`, not the audited repository
revision. The repository's own go-live state is `productionReady: false`;
eleven gates, all 51 duplicate-review decisions, and all 12 physical-device
UAT scenarios remain pending. The test suite has six failures, the governed
corrected catalogue dataset is absent, `npm audit` reports seven high-severity
advisories, and the security review reports three high and four medium
findings.

Do not promote this revision until the security, data, test, approval, and
physical-device gates below are closed and the exact approved revision is
deployed and verified.

## Release blocker register

| Priority | Blocker | Evidence | Required closure |
|---|---|---|---|
| P0 | Pharmacy login authority is derived from public directory evidence | Three high security findings cover a duplicate number spanning two tenants and automatic FDA/MMI contact promotion | Introduce explicit tenant-specific staff enrollment, make public contacts login-disabled by default, enforce one login principal per tenant, reconcile production mappings |
| P0 | Live release is stale | Seven live routes reported revision `37d8c1c...`; expected `20a7f703...` | Deploy the approved immutable revision, then rerun live verification until every route reports the expected revision |
| P0 | Formal launch gates are unapproved | `productionReady: false`; 0/11 gates confirmed | Record human approvals for security, Edge Functions, Turnstile, auth rate limits, retention, Cloudflare account, DNS and operational gates |
| P0 | Device UAT is absent | 0/12 physical-device scenarios passed | Complete the committed phone/device matrix, preserve screenshots/logs and approve all scenarios |
| P1 | Cross-order offer-item data exposure | Authenticated RLS policy checks only parent existence and grants direct child-table SELECT | Bind offer-item policy to customer ownership or pharmacy membership/recipient authorization; add cross-user direct-table tests |
| P1 | Governed catalogue input is missing | Expected corrected dataset under `outputs/.../corrected-catalog-dataset-2026-07-15.json` is absent | Restore the governed artifact or replace every consumer with a committed authoritative source; rerun all data/test gates |
| P1 | Application tests fail | 328/334 pass; six fail | Resolve four dataset-dependent failures, the missing approved product image expectation, and the product route returning 404 |
| P1 | Dependency audit fails | Seven high advisories, including Next.js 16.2.6 advisories; patched Next.js target is 16.2.11 | Upgrade and lock patched direct/transitive dependencies, rebuild, retest and require a clean or formally risk-accepted audit |
| P1 | Catalogue draft publication boundary can be bypassed | Base-table column grants expose description/source fields to anon/authenticated roles | Revoke base-table grants and expose approved content only through a governed view/RPC |
| P1 | Duplicate decisions incomplete | 0/51 duplicate groups decided: six product and 45 pharmacy groups | Complete governed merge/retain/reject decisions with reviewer evidence |

## Security review

The sealed Codex Security scan reviewed the exact Git revision. The
deterministic inventory ranked 211 included source-like files; the top 42
files received full-file review, with 42/42 completion receipts. Fourteen
candidate issues were reconciled; seven survived validation and attack-path
policy.

| Severity | Finding |
|---|---|
| High | Shared public roster number grants manager access to two pharmacy tenants |
| High | FDA public-directory contacts are promoted directly into pharmacy login authority |
| High | MMI directory contacts are promoted into login authority for 77 pharmacies |
| Medium | Offer-item RLS permits authenticated cross-order disclosure |
| Medium | Contact revocation can race with manager-membership creation |
| Medium | Base-table grants expose unapproved catalogue description drafts |
| Medium | Browser storage retains medicine selections, phone and precise location without expiry |

Seven other candidates were rejected or retained as deployment follow-ups,
including request-body limits, forwarded-header throttling trust, provider
logging, number enumeration, webhook status regression, and a privileged-only
audit-metadata path.

No destructive or state-changing security probe was run against production.
The database-grant issue was safely reproduced locally; other findings use
direct source traces and clearly record remaining production proof gaps.

## Build, test and data evidence

| Check | Result | Notes |
|---|---|---|
| `npm ci` | Pass | 520 packages installed with Node 22.22.3 / npm 10.9.8 |
| `npm run lint` | Pass | No lint failure |
| `npm run cloudflare:check:production` | Pass | Build, three production tests, and strict Wrangler dry-run passed |
| `npm run test:production` | Pass | 3/3 |
| `npm run performance:budget` | Pass after build | JS raw 809,496 B; estimated transfer 236,290 B; CSS transfer 34,117 B; initial visual 73,183 B |
| `npm run security:audit:python` | Pass | Ten Python packages checked; no advisories |
| `npm run data:quality` | Pass with warnings | 2,480 source-backed medicines; six duplicate-registration warnings |
| `npm run data:validate` | Fail | Governed corrected catalogue dataset is missing |
| `npm run python:test` | Fail | 171 tests ran; one error and one skipped, caused by the missing dataset |
| `npm test` | Fail | 328/334 pass; six fail |
| `npm audit` | Fail | Seven high-severity advisories |
| `npm run audit:closure:status:json` | Fail | Blocked by the missing governed dataset |

The Cloudflare upload dry-run is substantial: approximately 6.66 MiB
uncompressed and 1.07 MiB compressed, with the marketplace SSR module about
1.19 MiB. The current performance budget passes, but route/module splitting
should remain a post-blocker optimization target.

## Live website review

The live website resolves through Cloudflare and is publicly indexable.
Canonical URL, description, `lang="en-RW"`, `robots="index, follow"`, H1 and
skip-navigation semantics are present.

Desktop and a 390 x 844 mobile viewport were inspected:

- no browser console errors or warnings were observed;
- the primary marketplace rendered meaningful content with no framework
  error overlay;
- adding a medicine changed the basket from zero to one;
- the mobile viewport had no horizontal page overflow;
- controls inspected had usable accessible names;
- DNS resolved to Cloudflare addresses.

This is functional smoke evidence, not device certification. It does not
replace the repository's 12 pending physical-device UAT scenarios, authenticated
pharmacy workflows, GPS accuracy testing, WhatsApp OTP delivery, prescription
handling, or assistive-technology testing.

## Go-live gates

The repository's launch evidence records all of the following as pending:

- GPS and location workflow approval;
- WhatsApp delivery/OTP approval;
- product and pharmacy duplicate review;
- security deployment approval;
- Supabase Edge Function deployment approval;
- Turnstile production configuration;
- authentication rate-limit verification;
- prescription retention/deletion approval;
- Cloudflare account/production ownership;
- domain/DNS release evidence refresh;
- physical-device UAT.

DNS currently resolves correctly, but the stored domain evidence and release
revision are stale. DNS reachability alone is not a release approval.

## Minimum production closure plan

1. Freeze deployment promotion and preserve the current live rollback target.
2. Fix the three pharmacy identity/bootstrap findings; reconcile every active
   login contact in production and revoke ambiguous memberships/sessions.
3. Correct the offer-item RLS policy, catalogue base grants, and revocation
   transaction boundary; add database-level negative authorization tests.
4. Restore the governed corrected catalogue artifact and close all 51
   duplicate decisions.
5. Upgrade Next.js and affected transitive packages; require lint, all tests,
   production checks, data validation, Python audit and npm audit to pass.
6. Minimize or expire persisted customer phone/location/cart data and verify
   privacy-copy/consent alignment.
7. Deploy to a non-production environment and execute all 12 physical-device
   UAT scenarios, including GPS, OTP/WhatsApp, pharmacy login, order/offer,
   prescription, failure recovery, accessibility and performance.
8. Obtain explicit recorded human approvals for every launch gate.
9. Deploy the exact approved commit, rerun live route/revision verification,
   browser smoke tests and monitoring checks, and retain rollback evidence.

## Release acceptance criteria

Production can be reconsidered only when:

- no unresolved high security finding remains;
- every medium finding has either a verified fix or recorded risk acceptance
  by an accountable human owner;
- `productionReady` is true and all launch gates are confirmed;
- 51/51 duplicate decisions and 12/12 device scenarios are complete;
- lint, application tests, Python tests, data validation, production checks,
  dependency audits and deployment verification pass;
- the live revision header exactly matches the approved commit on every
  required route;
- monitoring, rollback, privacy/retention, secrets and operational ownership
  evidence is current.

## Audit limitations

No production database credentials or approved test accounts were supplied,
so authenticated customer/pharmacy flows and live RLS behavior were not
mutated or probed. Public live checks were limited to ordinary browser and
deployment-verification behavior. The security scan's coverage is partial:
all ranked inventory was triaged, while the highest-risk 42 files received
full-file review. These limits reinforce the no-go conclusion; they do not
remove the directly proven blockers.

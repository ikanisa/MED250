# MED250 backend-platform comparison — source and method notes

Snapshot date: 2026-08-23. Audience: MED250 product and engineering stakeholders.

## Decision question

Given the owner's hard constraint that a $25/month Supabase plan is not an option, which sub-$25 architecture should replace Supabase without putting MED250's pharmacy/client authorization and WhatsApp dispatch at unacceptable risk?

## MED250 repository evidence

The following inventory was measured from the local MED250 repository. It describes the implementation footprint, not the currently deployed database state.

- 81 SQL migration files under `supabase/migrations`.
- 16 Supabase Edge Function directories under `supabase/functions`.
- 36 unique tables created across the migration history.
- 135 SQL function definitions across the migration history.
- 39 trigger definitions, 36 policy definitions, and 12 view definitions across the migration history.
- Runtime client scan: 66 `.from(` calls, 45 `.rpc(` calls, 11 auth calls, 4 realtime/channel occurrences, and 3 storage calls.
- `db/schema.ts` is currently an empty D1 scaffold, so the Cloudflare database layer is not a feature-equivalent replacement.

Counts were produced with repository-local `find` and `rg` scans. Historical migrations can redefine the same object, so function, trigger, policy, and view counts indicate migration complexity rather than current object cardinality.

## Production-cost scenario

The chart compares an early-production monthly platform baseline in US dollars. It is a model, not an observed invoice. It excludes Twilio/Meta WhatsApp fees, domains, taxes, monitoring add-ons, data migration labor, engineering, support/on-call, and usage overages.

Modeled rows:

| Option | Monthly baseline | Basis |
|---|---:|---|
| Full Cloudflare D1/R2/Workers | $5.00 | Workers Paid minimum; early load assumed inside included D1, R2, Queues, and Durable Objects allocations. |
| Cloudflare + Neon free/low load | $5.00 | Workers Paid plus Neon Free while its capacity remains sufficient. |
| Cloudflare + Turso Developer | $10.99 | Workers Paid plus Turso Developer at $5.99. |
| Cloudflare + Neon typical Launch | $20.00 | Workers Paid plus Neon's published $15 typical intermittent 1 GB Launch example. |
| Railway self-host baseline | $20.00 | Railway Pro subscription minimum before resource overages; this is not a full production TCO. |

Options with a fixed $25 production baseline are excluded by the owner's budget constraint rather than treated as viable recommendations. Supabase Pro, Nhost Pro, and Appwrite Pro remain useful price comparators in the vendor-source review only.

Firebase is excluded from the bar chart because its production price is usage-variable rather than a comparable fixed baseline. PocketBase is excluded because the vendor says it is not recommended for production-critical applications before version 1.0.

## MED250-fit scoring method

Scores are analyst judgment, not vendor benchmarks. A hard budget gate first excludes any option with a fixed $25 monthly production baseline. The weighted 100-point model for the remaining candidates uses:

- PostgreSQL and migration compatibility: 20 points.
- Security and authorization fit for clients, pharmacies, prescriptions, locations, and private media: 20 points.
- Reliable asynchronous WhatsApp dispatch and retry capability: 15 points.
- Private media capability: 10 points.
- Realtime capability: 10 points.
- Predictable production cost: 10 points.
- Migration effort: 10 points.
- Rwanda latency/data-location fit: 5 points.

The model deliberately weights security, data-model fit, and reliable dispatch above the lowest nominal hosting price. A platform can therefore be cheaper but score lower if it forces MED250 to rebuild row-level authorization, transactions, or PostgreSQL logic. Under this budget gate, Cloudflare plus Neon scores highest because it preserves PostgreSQL while remaining below $25 in the modeled low-load and typical Launch cases.

## Chart contract

- Question: Which production architecture has the lowest modeled early monthly platform cost?
- Takeaway: full Cloudflare and Cloudflare plus Neon Free have the lowest platform baseline, but Cloudflare plus Neon is the stronger sub-$25 choice because it preserves PostgreSQL compatibility.
- Chart family: comparison and ranking.
- Chart type: sorted bar; the portable report renderer uses categories on the horizontal axis.
- Dataset: `cost_scenarios`, one row per architecture.
- Encoding: monthly US-dollar baseline by architecture.
- Caveat: scenario model; costs are not observed invoices.

## Architecture interpretation

### Supabase exit condition

Supabase Pro is excluded by the owner's budget constraint. Supabase is therefore only a source system to exit, not a recommended operating platform. The local migrations and functions can seed the replacement, but they cannot recover live rows, uploaded media, user identities, or provider-event history. If HTTP 402 prevents export, MED250 must request a read-only export or recovery path from Supabase support; otherwise live data preservation remains blocked.

### Cloudflare Workers + Neon Postgres

This is the recommended replacement under the sub-$25 constraint. Neon preserves PostgreSQL semantics and makes the existing schema and stored-procedure investment more portable. Cloudflare Workers can own the API and authorization boundary; R2 can hold prescription/product media; Queues can dispatch orders to the nearest ten pharmacies with retries and idempotency; Durable Objects or WebSockets can cover realtime state; Hyperdrive can pool and cache Postgres connections. Supabase Auth, PostgREST-style client calls, Storage APIs, Realtime, and Edge Functions still need deliberate replacements.

### Full Cloudflare with D1

This has the lowest integrated platform price, but it is the largest rewrite. D1 is SQLite-based, has a 10 GB maximum per paid database, and processes queries on a single thread. PostgreSQL functions, triggers, extensions, row-level security, and RPC behavior must be redesigned. Cloudflare's documented D1 placement hints do not include an Africa primary region, so latency must be measured from Rwanda rather than assumed.

### Other alternatives

- Nhost is a close PostgreSQL/GraphQL/Auth/Storage alternative, but its production starting price is also $25 and is therefore excluded. Its Free plan pauses after inactivity and is not a dependable production solution.
- Turso is inexpensive and capable, but it still imposes a SQLite/libSQL rewrite and adds another vendor beside Cloudflare. It is not stronger than D1 for a Cloudflare-first strategy.
- Appwrite and Firebase are capable backends, but their document-oriented data models would require a large redesign of MED250's relational/RPC-heavy backend.
- Self-hosted Supabase preserves the data model but transfers patching, backups, high availability, secrets, observability, abuse protection, and on-call responsibility to MED250. A small VPS price is not the total production cost.
- PocketBase is attractive for prototypes, but its own documentation advises against production-critical use before version 1.0 and describes single-server vertical scaling.

## Workload-specific controls

The pharmacy/client distinction must be enforced server-side from the normalized WhatsApp number. Pharmacy phone numbers are an allowlisted role; every other inbound WhatsApp number is treated as a client unless separately verified. A safe order flow needs:

1. Private media ingestion and malware/type/size validation.
2. Client identity and saved-location consent/versioning.
3. Geospatial nearest-pharmacy query with an explicit eligibility filter.
4. Transactional order plus outbox creation.
5. Queue fan-out to at most ten pharmacies, with idempotency keys, retries, dead-letter handling, and provider-status callbacks.
6. Direct-client number disclosure only to dispatched pharmacies, with audit logs and retention controls.

These controls are architectural requirements independent of the platform selected.

## Official vendor sources

- Supabase pricing: https://supabase.com/pricing
- Supabase changelog: https://supabase.com/changelog.md
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 data location: https://developers.cloudflare.com/d1/configuration/data-location/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Queues pricing: https://developers.cloudflare.com/queues/platform/pricing/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Hyperdrive pricing: https://developers.cloudflare.com/hyperdrive/platform/pricing/
- Cloudflare Hyperdrive database compatibility: https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/
- Neon pricing: https://neon.com/pricing
- Turso pricing: https://turso.tech/pricing?frequency=monthly
- Nhost pricing: https://nhost.io/pricing
- Appwrite pricing: https://appwrite.io/pricing
- Firebase pricing: https://firebase.google.com/pricing
- Firestore pricing: https://firebase.google.com/docs/firestore/pricing
- PocketBase documentation: https://pocketbase.io/docs/
- PocketBase FAQ: https://pocketbase.io/faq/
- Railway pricing: https://railway.com/pricing

## Evidence limits

- Prices and quotas can change; verify them again before procurement or migration execution.
- No load test from Rwanda, production query trace, storage-volume export, monthly active-user count, prescription-media growth forecast, or actual provider invoice was available for this report.
- The cost model therefore compares early platform baselines, not three-year total cost of ownership.
- A successful build or provider configuration is not live end-to-end evidence. A controlled client image/location request, nearest-ten dispatch, pharmacy reply, provider delivery status, audit record, and failure/retry test remain required regardless of platform.

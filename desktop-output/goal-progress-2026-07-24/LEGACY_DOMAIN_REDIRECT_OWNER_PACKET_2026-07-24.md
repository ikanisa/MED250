# MED+250 Historical Hostname Redirect Owner Packet

- Classification: infrastructure execution aid; not approval or deployment evidence
- Prepared: 24 July 2026
- Accountable owner: named MED+250 infrastructure owner with authority over the `gikundiro.com` Cloudflare zone
- Historical hostname: `https://med250.gikundiro.com`
- Canonical ordering origin: `https://med-250.com`
- Required posture: historical hostname is redirect-only and must never become a second ordering origin

## Current verified state

The canonical hostname resolves through Cloudflare and responds over HTTPS. The
historical hostname does not currently resolve. The privacy-safe five-route
probe therefore failed `0/5` with `dns_unresolved`.

Current receipt:

`desktop-output/goal-progress-2026-07-24/legacy-domain-redirect-probe-2026-07-24.json`

Receipt SHA-256:

`2e4dac4963ba1f04488547b3803be399904698655491dc0348429e27312fee46`

This failed receipt documents the current gap. It is not permission to change
the zone and must not be relabelled as passing evidence.

## Owner decision and required input

The accountable zone owner must explicitly authorize all of the following:

1. creation of a proxied DNS record for `med250.gikundiro.com`;
2. issuance and activation of a valid TLS certificate for that exact hostname;
3. a Cloudflare redirect rule or equivalent isolated redirect service that
   sends every request to `https://med-250.com` with the original path and
   query preserved;
4. use of permanent HTTP `301` or `308`; `308` is preferred;
5. no cookies, application content, authentication, ordering, API, Supabase,
   OTP, CORS, sitemap, or canonical-page service on the historical hostname;
6. a rollback record that removes the redirect rule and DNS record without
   changing the canonical Worker route.

The owner must provide a named approval reference, approved change window,
rollback owner, and least-privilege Cloudflare execution identity. Do not place
credential values, account IDs, zone IDs, staff contact details, or private
approval content in Git.

## Acceptance

After the owner-authorized change:

```sh
npm run domain:legacy-redirect:verify
```

The command must report:

- `status: passed`;
- `5/5` probes passed;
- only HTTP `301` or `308`;
- exact redirects to `https://med-250.com`;
- complete path and query preservation;
- no `Set-Cookie` response;
- a current verifier SHA-256 and capture timestamp.

Then create a new immutable receipt at a new path:

```sh
npm run domain:legacy-redirect:verify -- \
  --evidence-output desktop-output/goal-progress-YYYY-MM-DD/legacy-domain-redirect-probe-YYYY-MM-DD.json
```

Finally, update the readiness evidence reference, regenerate the closure board,
and run:

```sh
npm run launch:go-live:status
npm run release:check:live
```

The redirect pass remains infrastructure evidence only. Production still
requires source authority, all reviewer decisions, 11/11 launch gates, 12/12
physical UAT, current rendered audit approval, staged backend hardening,
production promotion approval, exact live revision equality, monitoring, and
rollback proof.

# GitHub Free-Only Policy

MED+250 uses GitHub only under a free account and must never depend on a
billable GitHub product or paid usage.

This is a permanent release constraint:

- do not upgrade the repository owner or organization to a paid GitHub plan for
  MED+250;
- do not enable paid Actions capacity, Actions overages, larger runners,
  paid-hosted runners, paid Marketplace apps, paid Packages storage, or another
  GitHub add-on that can generate a charge;
- keep every workflow manual-only and optional;
- use only included free-tier `ubuntu-latest` minutes after both the free
  account and available free Actions allocation have been explicitly confirmed;
- if the included allocation is unavailable, exhausted, or uncertain, do not
  dispatch the workflow;
- run the authoritative release checks locally and deploy directly to the
  approved Cloudflare account with the repository scripts.

GitHub workflow availability is not a launch gate. A disabled or skipped
workflow must not block a release whose local immutable evidence is complete,
and a passing GitHub workflow must not replace the governed launch evidence,
named approvals, physical-device UAT, or exact-revision production
verification.

The repository validator is:

```sh
npm run github:free-only:verify
```

It fails if a workflow becomes automatic, allocates a hosted runner before the
two free-only confirmations, or selects a non-standard hosted runner.

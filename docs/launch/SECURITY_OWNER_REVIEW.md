# MED+250 security-owner review

Prepared: 16 July 2026

Decision owner: MED+250 security owner

Release: `med250-production`

## Purpose and status

This packet covers the three security-owner launch gates:

- `MED250_GATE_CREDENTIALS_ROTATED`
- `MED250_GATE_TURNSTILE_SERVER_VERIFIED`
- `MED250_GATE_AUTH_RATE_LIMITS_APPROVED`

It does not authorise a credential rotation in the shared Supabase project, approve project-wide Auth settings, or substitute for the controlled browser test. Every artifact remains pending until a named accountable owner completes the work and signs it.

## Current verified baseline

The existing redacted security evidence records:

- backend contract `2026-07-18.3`;
- Supabase server-side Turnstile enforcement enabled for anonymous customer identities;
- missing and invalid Turnstile tokens rejected without changing the aggregate Auth user count;
- anonymous customer identities enabled;
- an anonymous-user rate-limit value of 30;
- a one-hour JWT lifetime;
- refresh-token rotation enabled;
- reviewed security migrations and Edge Functions deployed;
- strict backend and aggregate operational verification available through protected process-only credentials.

The following are not yet proven:

- every previously exposed privileged Supabase credential has been replaced and revoked;
- every dependent system uses only the replacement credential;
- every old credential fails;
- the real production Turnstile widget positive path creates and removes one disposable anonymous identity;
- the project-wide anonymous-auth limit is acceptable to all shared-project owners;
- a controlled intended-use and abuse-limit test has passed without residual identities or marketplace data.

## Gate 1: privileged credential rotation

### Scope

The security owner must create a private inventory of every previously exposed or ungoverned credential, including:

- Supabase secret API credentials;
- database passwords and connection credentials;
- personal CLI or management credentials used for Supabase administration;
- downstream copies in protected CI environments, local operator stores, deployment platforms, monitoring jobs, and scheduled operations;
- any credential that was copied into logs, chat, screenshots, shell history, temporary files, or another uncontrolled location.

Never place credential values, identifiers, suffixes, fingerprints, unredacted account names, or screenshots in repository evidence.

### Shared-project safety

The Supabase project is shared with other applications. Before rotating a project-wide credential:

1. identify every dependent application, job, person, and environment;
2. obtain the relevant owners' maintenance-window approval;
3. define the rollback contact and maximum interruption window;
4. ensure replacement values can be installed without exposing them;
5. verify that changing the credential will not silently disable unrelated applications.

### Required rotation order

Use the following order for each credential class:

1. Record the credential class, accountable owner, dependent systems, and planned revocation time in the private rotation ledger.
2. Create the replacement through the authoritative provider interface.
3. Store the replacement only in the intended protected secret stores.
4. Update one dependent system at a time.
5. Run a scoped positive check from every updated dependency.
6. Revoke the old credential.
7. Prove the old credential fails without printing its value or the provider response body.
8. Re-run the scoped positive checks with the replacement.
9. Search repository history, current files, build output, shell history, logs, issue trackers, and evidence artifacts for residual secret material using an approved secret scanner.
10. Record only redacted pass/fail results in the deployment receipt.

### Minimum post-rotation checks

After the Supabase credential rotation:

```sh
npm run backend:verify
npm run ops:health:strict
npm run security:audit
npm run launch:evidence:verify
```

Also verify:

- the protected production and preview workflows can read the intended secrets;
- no browser bundle or public Worker binding contains a privileged credential;
- scheduled prescription cleanup still runs;
- pharmacy OTP, geocoding, and contact-review functions retain only their intended privileges;
- an old credential cannot perform its former operation;
- the replacement performs no broader operation than intended.

### Required artifacts

- `docs/launch/evidence/credentials-rotation-deployment-receipt-pending-2026-07-16.json`
- `docs/launch/evidence/credentials-rotation-approval-pending-2026-07-16.json`

## Gate 2: Turnstile production positive path

### Existing proof

`docs/launch/evidence/security-hardening-test-2026-07-16.json` records the controlled missing-token and invalid-token rejection checks. Those checks prove the server rejects absent or invalid CAPTCHA evidence without increasing the aggregate Auth user count.

### Remaining controlled test

Use a production browser and the real widget:

1. Open the production customer flow without adding products or sending an availability request.
2. Complete the real Turnstile widget.
3. Capture the short-lived response only in the operator process environment as `TURNSTILE_TEST_TOKEN`.
4. Supply the production Supabase URL, publishable key, and protected secret API credential to the same process.
5. Run:

   ```sh
   npm run security:turnstile:verify -- --require-valid
   ```

6. Confirm the command reports:
   - missing token rejected;
   - invalid token rejected;
   - one disposable anonymous identity created with the valid token;
   - its session revoked;
   - its Auth record deleted;
   - the aggregate Auth user count restored;
   - no identifier or token emitted.
7. Confirm no cart, request, prescription, pharmacy message, or marketplace row was created.
8. Retain only the redacted JSON command result and complete the pending test artifact.

If the browser token expires, is already consumed, or the positive path fails, do not weaken Turnstile. Obtain a new token and repeat the controlled test.

### Required artifact

- `docs/launch/evidence/turnstile-positive-path-test-pending-2026-07-16.json`

## Gate 3: anonymous-auth rate-limit approval

### Decision boundary

The anonymous-auth rate limit is a shared project-wide setting. The security owner must not change it solely for MED+250 without reviewing every application that relies on the same Auth project.

The approval must record:

- the selected limit and time window;
- the current MED+250 customer-session design;
- expected legitimate peak anonymous-session creation;
- the effect on other shared-project applications;
- abuse and denial-of-service risk;
- monitoring and alert thresholds;
- who may change the limit;
- rollback criteria;
- the next review date.

### Controlled test plan

Use approved disposable browser identities and a maintenance window:

1. Record the aggregate Auth user count before the test.
2. Confirm one intended customer can complete the real Turnstile widget and obtain an anonymous session.
3. Confirm that session can browse and begin the MED+250 customer flow without creating an availability request.
4. Use fresh real Turnstile responses and approved disposable clients to exercise the agreed creation threshold.
5. Confirm attempts above the approved threshold are rejected with a rate-limit response.
6. Confirm CAPTCHA rejection remains distinct from rate-limit rejection.
7. Revoke every disposable session and delete every disposable Auth identity.
8. Confirm the aggregate Auth user count returns to the pre-test count.
9. Confirm no customer request, pharmacy notification, prescription, or contact record was created.
10. Inspect privacy-safe logs and aggregate health for unintended impact on MED+250 or other shared-project applications.

Do not record tokens, user identifiers, IP addresses, phone numbers, request identifiers, or raw provider responses in the repository artifact.

### Required artifacts

- `docs/launch/evidence/auth-rate-limit-test-pending-2026-07-16.json`
- `docs/launch/evidence/auth-rate-limit-approval-pending-2026-07-16.json`

## Completion and registry rule

Pending artifacts must remain outside `data/launch-evidence.json`. After an artifact is genuinely complete:

1. validate it strictly;
2. calculate its exact SHA-256 digest;
3. add the required evidence entry to the correct gate;
4. add the named gate approver, role, and timezone-qualified approval timestamp;
5. set the gate to `confirmed` only after `npm run launch:evidence:verify:live` accepts it.

The three security gates are independent. Passing the Turnstile test does not approve rate limits, and rotating credentials does not approve either Auth control.

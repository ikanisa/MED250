# MED+250 security-owner review

Prepared: 16 July 2026

Decision owner: MED+250 security owner

Release: `med250-production`

## Purpose and status

This packet covers the two security-owner launch gates:

- `MED250_GATE_TURNSTILE_SERVER_VERIFIED`
- `MED250_GATE_AUTH_RATE_LIMITS_APPROVED`

It does not approve project-wide Auth settings or substitute for the controlled browser test. Every artifact remains pending until a named accountable owner completes the work and signs it.

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

- the real production Turnstile widget positive path creates and removes one disposable anonymous identity;
- the project-wide anonymous-auth limit is acceptable to all shared-project owners;
- a controlled intended-use and abuse-limit test has passed without residual identities or marketplace data.

## Gate 1: Turnstile production positive path

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
8. Retain only the redacted JSON command result and build the completed launch
   artifact:

   ```sh
   npm run security:turnstile:evidence:build -- \
     --input desktop-output/goal-progress-YYYY-MM-DD/turnstile-verifier-result.json \
     --date YYYY-MM-DD \
     --executed-by "Named security tester" \
     --executor-role "Security owner" \
     --started-at "YYYY-MM-DDTHH:mm:ss+02:00" \
     --completed-at "YYYY-MM-DDTHH:mm:ss+02:00" \
     --no-marketplace-side-effect-confirmed
   ```

If the browser token expires, is already consumed, or the positive path fails, do not weaken Turnstile. Obtain a new token and repeat the controlled test.

### Required artifact

- `docs/launch/evidence/turnstile-positive-path-test-YYYY-MM-DD.json`

## Gate 2: anonymous-auth rate-limit approval

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

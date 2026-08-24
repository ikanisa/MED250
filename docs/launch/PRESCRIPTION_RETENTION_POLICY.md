# MED+250 prescription access and retention policy

Release: `med250-production`

Status: pending privacy-owner approval. This document records the implemented data lifecycle and must not be represented as an approved privacy policy until the matching evidence artifact is signed.

## Purpose

MED+250 accepts a prescription file only when a customer chooses to attach one for an availability request that requires it. The file supports a private customer-to-pharmacy workflow; it is not a public catalogue asset, analytics input or marketing record.

## Access boundary

- The prescription bucket is private.
- The customer who uploaded the file may access it through the governed customer workflow.
- A pharmacy that merely receives an availability request sees only that a prescription is present.
- Only the pharmacy selected by the customer may access the file.
- Selected-pharmacy access starts after selection and ends no later than 24 hours after selection.
- The selected pharmacy receives a short-lived signed link, capped at 10 minutes and never extending beyond the remaining 24-hour selection window.
- An unrelated pharmacy, non-member pharmacy user, anonymous visitor or unselected recipient must not access the file.
- Browser clients cannot replace a prescription object by update or upsert.
- Application logs, telemetry and launch evidence must not contain prescription contents, object paths, customer identifiers or request identifiers.

## Retention periods

The implemented cleanup lifecycle is:

- Unreferenced or abandoned upload: eligible for deletion after 24 hours.
- Cancelled or expired request: eligible after the file is no longer protected by an active or ambiguous reference and the governed 24-hour conditions are satisfied.
- Selected request: pharmacy access ends after 24 hours from selection; the request is automatically expired if still open.
- Completed request: prescription file is eligible for deletion after 30 days.

These are maximum implemented operational periods, not permission to retain a file when deletion is lawfully required sooner.

## Cleanup schedule and safety controls

- The protected cleanup function is scheduled every six hours.
- Cleanup uses service-only access and is not callable by public browser roles.
- Work is grouped by object path so every reference to the same object is evaluated together.
- A 15-minute database lease prevents a new order reference from racing with deletion.
- Before deleting an orphan, cleanup independently proves that no committed order references the object.
- Before deleting a referenced object, cleanup proves that every reference is outside its applicable retention window.
- Database references are cleared only after Storage confirms successful deletion.
- Expired cleanup claims are recovered and retried.
- Separate capacity is reserved for expired claims and newly due paths so recurring failures cannot indefinitely starve new cleanup.
- A failed deletion remains visible to aggregate operational health and must not be represented as complete.

## Customer deletion

A customer may delete a definitively unused upload through the governed workflow. A file that may belong to an ambiguous order retry remains protected until the system can safely determine whether a committed reference exists.

## Pharmacy handling

A selected pharmacy must:

- open the prescription only when necessary for the selected request;
- restrict access to authorized staff with a legitimate role;
- avoid screenshots, forwarding, personal-device storage and messaging-group distribution;
- avoid copying the file into public notes, catalogue records or launch evidence;
- follow applicable professional and legal requirements when a separate pharmacy record is required; and
- report suspected unauthorized access immediately.

MED+250 does not decide whether a prescription is clinically or legally valid. That decision belongs to the responsible pharmacy professional under applicable rules.

## Incident procedure

For suspected unauthorized access, disclosure, incorrect pharmacy selection or cleanup failure:

1. Stop unnecessary access and revoke affected sessions or links where possible.
2. Preserve a minimal redacted event timeline in the controlled incident system.
3. Notify the privacy and security incident contacts.
4. Determine the affected data, access window and recipients without copying prescription content.
5. Correct the membership, selection, Storage, cleanup or authorization condition.
6. Follow the approved legal assessment and notification procedure.
7. Re-run access-boundary and cleanup verification before closing the incident.

## Monitoring and evidence

Operations may monitor aggregate counts and cleanup health only. Evidence may record:

- cleanup run time and health;
- due, deleted, failed and recovered aggregate counts;
- whether the schedule is current; and
- whether access and retention tests passed.

Evidence must not record file content, object paths, customer or pharmacy identities, phone values, request identifiers or exact locations.

## Policy review

The privacy owner must review this policy whenever a change affects:

- upload requirements;
- customer or pharmacy access;
- signed-link duration;
- selection or request expiry;
- deletion periods;
- cleanup scheduling, claims, leases or retry behavior;
- Storage policies;
- incident response; or
- applicable privacy, health-data or pharmaceutical obligations.

Material changes require updated tests and a new signed approval.

## Approval checklist

The privacy owner may sign only after confirming:

- the 24-hour orphan and selected-access rules are acceptable;
- the 30-day completed-request rule is acceptable;
- the six-hour schedule and 15-minute lease are operationally appropriate;
- the short-lived link and role boundaries match the intended workflow;
- the controlled cleanup test and current health evidence pass;
- accountable privacy and security incident contacts are assigned;
- any controller, processor, transfer, notification or legal-basis conditions are recorded in the signed decision; and
- the approval artifact is redacted.

After this review, build the completed signed approval with
`npm run privacy:prescription-retention:evidence:build` and record the resulting
`docs/launch/evidence/prescription-retention-approval-YYYY-MM-DD.json` artifact
in the launch registry.

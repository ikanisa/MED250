# MED+250 pharmacy marketplace operations procedure

Release: `med250-production`

Effective only after approval: this procedure describes the current implemented operating model. It does not become an approved production policy until the MED+250 operations lead signs the matching launch-evidence artifact.

## 1. Purpose and operating model

MED+250 is an information-first pharmacy marketplace. It helps a customer identify a licensed pharmacy that confirms it can help with requested products.

- Only pharmacies participate as marketplace fulfilment providers.
- Products, taxonomy and optional indicative “From RWF” prices are maintained centrally.
- MED+250 does not publish pharmacy-specific stock or pharmacy-specific price lists.
- A central indicative price is informational and non-final.
- A pharmacy privately confirms product availability for a customer request.
- Any price entered by a pharmacy is optional, private, indicative and non-final.
- The customer and selected pharmacy reconfirm exact products, final price and fulfilment on WhatsApp.
- An order is optional and occurs only after that direct interaction.
- MED+250 does not collect or hold customer payment.
- Catalogue presence is not diagnosis, prescribing, treatment advice or proof of availability.

## 2. Accountable operating roles

The operations lead must assign named people to these roles in the controlled staff register:

- Operations lead: owns this procedure, production activation and incident decisions.
- Pharmacy evidence reviewer: reviews pharmacy identity, licence, premises and contact evidence one record at a time.
- Pharmacy support operator: handles pharmacy access and contact-correction requests.
- Customer support operator: handles request-status, privacy and correction enquiries without providing medical advice.
- Security incident contact: handles suspected account compromise, unauthorized access, credential exposure and messaging abuse.
- Privacy incident contact: handles prescription, location, contact and customer-data incidents.
- Regulatory escalation contact: handles medicine-status, advertising, prescription, substitution and professional-practice concerns.

One person may hold more than one role only when the operations lead records that assignment and the access granted remains necessary for the role.

## 3. Pharmacy participation and routing eligibility

A pharmacy may receive customer availability requests only while all of the following are true:

- the pharmacy is an active current entry in the governed Rwanda FDA pharmacy registry;
- marketplace participation is active;
- the licence has not expired;
- at least one WhatsApp contact has `source_verified` or `admin_verified` evidence.

Receiving an order does not require pharmacy-portal access. Portal access is a
separate administrative permission granted only to a login-enabled WhatsApp
contact after the pharmacy asks the MED+250 administrator to add it.

GPS improves nearby ranking but is not fabricated or inferred. Routing behaves as follows:

- pharmacies with approved coordinates within 10 km are prioritized by distance;
- the request is sent to at most 10 eligible pharmacy responders;
- eligible pharmacies outside the verified nearby set may be included through the stable national responder fallback;
- a pharmacy without verified proximity is shown as national service coverage, never with an invented distance; and
- a national responder must confirm practical pickup or delivery arrangements before the customer proceeds.

When identity, licence, contact authority or premises evidence becomes stale or disputed, the reviewer must quarantine the affected field or disable routing until the evidence is resolved.

## 4. Customer availability request

The customer submits one request containing:

- one to 50 unique central-catalogue products and their quantities;
- pickup, delivery or either as the fulfilment preference;
- location supplied with browser permission;
- a customer WhatsApp contact;
- substitute consent; and
- a prescription upload when the selected catalogue products require one.

The system permits only one active request per customer. The request is idempotent by its customer request identifier so a retry must return the same committed request instead of creating a duplicate.

The standard availability-response window is two hours. The request is not a completed purchase, reservation or stock guarantee.

## 5. Pharmacy availability confirmation

An authorized pharmacy member must inspect the complete request and respond only for the pharmacy represented by their active membership.

For every requested product, the pharmacy must record whether it is available. A confirmation presented to the customer as complete must cover every requested product.

The pharmacy must:

- confirm the requested quantity;
- use the exact central product when no substitute is allowed;
- propose a substitute only when the customer allowed substitution;
- use only an active, orderable substitute compatible with the governed generic name, strength, dosage form and pack-size rules;
- never introduce a prescription product when no valid prescription is attached;
- record pickup, delivery or either consistently with the request;
- provide an approximate ready time only when the pharmacy can reasonably support it; and
- use the note field only for operational follow-up, not diagnosis or prescribing.

A price estimate is optional. If entered, it is private and non-final. It does not change the central product price, create a pharmacy price list or assert public stock.

The pharmacy must not confirm an unavailable product merely to receive the customer contact.

## 6. Customer comparison and selection

Before selection:

- the customer may see only complete pharmacy confirmations;
- pharmacy contact details remain private;
- the pharmacy receives only the request information needed to decide whether it can help;
- exact customer contact and prescription access remain unavailable; and
- MED+250 must not imply that a confirmation is a completed sale.

The customer may choose at most one complete confirmation. Selecting one pharmacy expires competing confirmations.

After selection:

- only the selected pharmacy’s governed contact may be shown to the customer;
- only the selected pharmacy may receive the customer contact and private prescription access allowed by the system;
- both parties must reconfirm the exact products, final price and pickup or delivery on WhatsApp; and
- either party may decide not to proceed.

## 7. WhatsApp handoff

WhatsApp is a direct handoff between the customer and the selected pharmacy.

- Opening WhatsApp always requires an explicit user action.
- The prefilled message may include the opaque MED+250 request reference and a request to reconfirm products, final price and fulfilment.
- Medication details, prescription contents and exact location must not be placed in the prefilled message.
- Pharmacy staff must verify they are communicating about the correct request before sharing details.
- Staff must not request payment merely because MED+250 shows a confirmation.
- A WhatsApp conversation is governed by the pharmacy’s professional obligations and the applicable messaging-service terms.

## 8. Prescription handling

Prescription files are private and must never be copied into public notes, logs, screenshots, chat groups or launch evidence.

- A pharmacy that is only a request recipient sees a prescription-present flag, not the file.
- Only the customer and the selected pharmacy may access the file.
- A selected pharmacy receives a short-lived signed link that never extends beyond the 24-hour selection window.
- Staff must open a prescription only when necessary to handle the selected request.
- Staff must not download or retain a copy outside approved pharmacy systems unless applicable law and the pharmacy’s approved procedure require it.
- Suspected invalid, incomplete or inappropriate prescriptions must be escalated to the pharmacy’s responsible professional; MED+250 must not make the clinical decision.
- Prescription access ends when the selected window expires or access is otherwise revoked.

The approved privacy policy governs the implemented cleanup periods: abandoned or unreferenced files after 24 hours, selected-pharmacy access for 24 hours, and completed-request files after 30 days.

## 9. Completion, cancellation and expiry

The customer controls normal request closure in MED+250.

- Before selection, the customer may cancel an active request.
- After selection, the customer may mark the request completed or cancelled.
- Completion means only that the MED+250 connection workflow is closed; it is not proof of payment, dispensing or delivery.
- The initial availability request expires after two hours when no pharmacy is selected.
- A selected request expires after 24 hours if it remains open.
- Expiry or cancellation closes active confirmations and removes access that depends on an active selected request.
- A customer may create a new request after the prior active request is closed.

Pharmacy staff must not continue using expired MED+250 access. Any later interaction is a direct pharmacy-customer interaction and must be handled under the pharmacy’s own lawful procedures.

## 10. Contact correction and pharmacy access

Pharmacy-portal access uses an admin-approved, login-enabled WhatsApp contact.
It is independent from the verified WhatsApp destination used for order
dispatch.

- A source-verified WhatsApp contact may receive order notifications without
  being granted portal access.
- A public-source contact must never become a portal login merely because it
  can receive a dispatch message.
- A pharmacy member may request an addition, replacement or removal from the pharmacy portal.
- An operator must inspect and decide exactly one request at a time.
- Approval requires direct pharmacy or authoritative-source verification, a named reviewer and a useful evidence note.
- Rejected, stale, disputed or cross-pharmacy-conflicting contacts must remain disabled or quarantined.
- When a primary login contact is removed or compromised, disable it promptly and require a newly verified contact before restoring access.
- Never place verification codes, phone numbers or account identifiers in launch evidence.

## 11. Pharmacy location correction

Location evidence is governed separately from contact evidence.

- Candidate coordinates do not become approved GPS automatically.
- The reviewer must inspect the exact premises identity, locality, source version and accuracy.
- Approval must identify the source and reviewer.
- A slow automated lookup must never overwrite a newer human decision.
- Disputed, relocated or stale coordinates must be removed from nearby ranking until reverified.
- Google Maps links alone do not prove authoritative pharmacy GPS.

## 12. Price, stock and payment boundaries

Operations staff and pharmacies must preserve these boundaries:

- do not publish pharmacy stock;
- do not publish pharmacy-specific catalogue prices;
- do not treat a central indicative price as final;
- do not use an Amazon price or an Amazon currency conversion;
- do not claim that an availability confirmation reserves stock;
- do not claim that MED+250 processed, guaranteed or refunded a payment; and
- do not activate automated payment custody without a separately approved licensed payment-service workflow.

When price evidence is stale or disputed, clear the optional central indicative price while leaving the product available as information where otherwise permitted.

## 13. Incident handling

Anyone who identifies a suspected incident must preserve privacy, stop unnecessary access and notify the accountable contact.

### Pharmacy identity or contact incident

1. Disable or quarantine the affected login contact.
2. Preserve a redacted event timeline without phone numbers or verification codes.
3. Confirm pharmacy identity through an approved independent channel.
4. Review recent contact edits and pharmacy sessions.
5. Restore access only after a new governed contact decision.

### Prescription or customer-data incident

1. Revoke affected access where possible.
2. Stop screenshots, forwarding and further processing.
3. Notify the privacy and security incident contacts.
4. Preserve only the minimum controlled evidence required for investigation.
5. Follow the approved breach-assessment and notification procedure.

### Incorrect pharmacy routing or disclosure

1. Close the affected request when safe.
2. Confirm whether an unrelated pharmacy obtained access.
3. Disable the incorrect membership, contact or location evidence.
4. Notify the customer and pharmacy only through the approved incident process.
5. Correct the authoritative record and repeat the isolation checks before reactivation.

### Medicine, substitution or regulatory concern

1. Unpublish or make the affected product non-orderable when continued exposure may be unsafe or non-compliant.
2. Escalate to the regulatory owner and responsible pharmacy professional.
3. Do not invent a classification, indication or replacement product.
4. Record the authoritative decision and source before restoration.

### Platform or messaging outage

1. Do not represent a failed request or message as delivered.
2. Keep affected requests visibly pending, failed or closed according to actual state.
3. Disable live request submission if safe fulfilment or privacy boundaries cannot be maintained.
4. Restore service only after the relevant health checks and smoke tests pass.

## 14. Operational monitoring

The operations team must use privacy-safe aggregate monitoring.

At the start of an operating shift and after a material deployment:

- run the strict operational-health check;
- confirm catalogue and central indicative-price integrity;
- confirm eligible pharmacy, WhatsApp and dispatch counts are not unexpectedly degraded;
- confirm recent verification delivery failures and prescription cleanup health;
- review unresolved pharmacy contact and location requests; and
- escalate any critical finding before continuing live request handling.

Logs and evidence must not contain product selections, request identifiers, pharmacy identifiers, phone numbers, prescription contents or exact customer locations.

## 15. Release and change control

This procedure must be reviewed whenever a change affects:

- pharmacy eligibility or national fallback routing;
- catalogue, price or stock presentation;
- request, confirmation, selection, cancellation or expiry behavior;
- WhatsApp, MoMo or payment handling;
- prescription access or retention;
- pharmacy contact or GPS governance;
- monitoring or incident response; or
- applicable regulatory or privacy obligations.

Material changes require updated tests, owner review and a new signed approval. A passing automated test does not replace accountable operational approval.

## 16. Approval checklist

The operations lead may sign only after confirming:

- named staff are assigned to the accountable roles;
- the production pharmacy set and escalation contacts are controlled outside the public repository;
- staff understand that only pharmacies participate;
- central prices are indicative and pharmacy estimates are private and non-final;
- no public pharmacy stock or pharmacy-specific price list is supported;
- staff understand nearby routing and national fallback labels;
- WhatsApp contacts and GPS evidence follow their record-level review procedures;
- cancellation, expiry, prescription and incident procedures are operationally usable;
- the current strict operational-health check passes; and
- the signed approval artifact contains no credentials, phone numbers, customer identifiers, prescription content or exact coordinates.

The approval decision, approver name, role and timezone-qualified timestamp belong in `docs/launch/evidence/pharmacy-operations-approval-pending-2026-07-16.json`.

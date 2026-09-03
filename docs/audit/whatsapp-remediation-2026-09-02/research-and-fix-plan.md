# MED+250 WhatsApp: critical research and remediation plan

Research date: 2 September 2026. Decision document, not a deployment or legal opinion.

## Recommendation

Keep the existing Twilio sender and Cloudflare Worker/D1/private R2/Queues architecture. Repair the concrete delivery and conversation defects; obtain the exact rejection reason before another submission; and resolve whether the actual prescription-routing workflow is permitted before unrestricted pharmacy broadcasting.

Do not equate template approval with approval of the business model, provider acceptance with delivery, or ten selected pharmacy records with ten recipients receiving the complete request. No provider migration, new Meta app, Facebook runtime token, Supabase or Neon is proposed.

The requested WhatsApp-image workflow remains a conditional design. If it is not permitted, the fallback is an authenticated Cloudflare pharmacy portal, with only specifically permitted WhatsApp communications—or portal-only operation if related notifications are also disallowed. This would change the user experience and requires the owner's approval.

## Evidence and corrections to the previous audit

The [earlier audit](../whatsapp-template-audit-2026-09-02.md) records the authenticated provider observations around 09:09–09:17 GMT+2. Those statuses have not been refreshed for this research:

| Purpose | Last observed state | Consequence |
| --- | --- | --- |
| Image V4, `HX4c2a1289aeeaf9b7d75782f3ff617aa9` | Rejected; exact reason absent in inspected Console tabs | Not a production replacement |
| Image V3, `HXc40fbd759da820c338972f0f0e8c4a09` | Pending | Not approved yet at that observation |
| Configured image V2, `HXfb3ab7b129be309d85a19195861e48ad` | Received | Twilio submission state is not Meta approval |
| Configured web-order / OTP templates | Received | Need separate resolution, not just image-template work |
| Manual location / saved location / dispatch-share templates | Not submitted | Service-window use must be checked per recipient; not universally sendable |

Important corrections and new findings:

1. **Healthcare businesses are not categorically banned.** Twilio's business-use overview includes pharmaceuticals. This does not settle which activities a pharmacy marketplace may perform. [Twilio allowed business types](https://help.twilio.com/articles/360039737793).
2. **We do not know why V4 was rejected.** Duplicate content is plausible because V3 and V4 retained the same body with different labels. It is an inference, not a diagnosed rejection code.
3. **The existing `wa.me` Share URL is not a sound approval-ready design.** The earlier audit's “suitable in-session” description did not adequately distinguish supported content type, approval risk and actual mobile behavior.
4. **Media defects exist independently of approval:** HEAD returns 405; the input path permits 16 MiB and WebP without converting them to compliant ordinary outbound images.
5. **Multi-image aggregation must also change delivery accounting.** Simply sending more photos can incorrectly count image messages as pharmacies.

Current-turn checks: official documentation research, targeted local source review, and one local synthetic HEAD request. The request returned `{"status":405,"allow":"GET"}` without credentials, database access or network transmission. The initial Node strip-only invocation could not parse a TypeScript parameter property; rerunning with its transform-types flag executed the check. No new full regression suite or physical-phone test was run. The earlier 31 passing tests are mock/fixture evidence, not live deliveries.

## 1. Resolve the actual approval failure

Read the approval resource for V4, V3, configured V2, the web-order template and OTP:

```text
GET https://content.twilio.com/v1/Content/{ContentSid}/ApprovalRequests
```

Record the returned account/SID, WhatsApp status, category and `rejection_reason`, with a timestamp. This is a Twilio read using existing authorized credentials; it does not require installing a Facebook runtime token. No authenticated approval-resource read was performed during this research. [Twilio Content API status resource](https://www.twilio.com/docs/content/create-and-send-your-first-content-api-template).

Twilio documents duplicate content under another name, direct `wa.me` CTA links, format problems and category mismatches as rejection causes. It also classifies mixed promotional/utility content as Marketing. Use the actual reason to select a remedy rather than producing V5 blindly. [Twilio approval guidance](https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses).

| Evidence returned | Targeted remedy |
| --- | --- |
| No Meta registration / still Received | Ask support to repair or confirm WABA submission and identify the Meta-side template; do not deregister the sender |
| Duplicate rejection | Ask which template conflicts; correct the intended content meaningfully and resubmit once, preserving prior SIDs |
| Format/media error | Correct the specific variables, supported media, URL response and samples; use synthetic samples with truthful use-case disclosure |
| Category mismatch | Use the correct category if the workflow is permitted; separate optional referrals from operational notifications |
| Policy rejection | Seek a reasoned review if incorrectly applied; otherwise change the actual workflow, not merely its labels |
| Pending with valid registration | Track that submission; do not confuse it with a Received/linkage failure |

Support ticket #29185539 should receive a single diagnostic packet containing all affected SIDs, timestamps, exact errors, proposed content/payload maps and the real Rwanda data flow. Ask whether the pharmacies' agreed request-notification subscription qualifies for Utility; a client's request alone should not be assumed to establish the pharmacy recipient's template category.

Twilio's appeal instructions route eligible cases through WhatsApp Manager and state that Meta controls the final decision. Administrative browser access for an appeal is separate from adding a Meta token to the application. Preserve edits in Twilio to avoid provider/Meta definitions drifting. [Twilio appeal procedure](https://help.twilio.com/articles/37014510989979-How-to-Appeal-WhatsApp-Template-Recategorization-or-Rejected-Templates).

### A real alternative to ask about—not assume enabled

Twilio currently advertises **Utility direct send (Beta)** without advance template submission. Public material reviewed did not establish this account's eligibility, media/button support or operational guarantees. Ask Mary whether it is available for this WABA and permitted use case, its pricing, failure behavior and fallback. Do not make a beta dependency part of initial production or treat it as a policy bypass. [Twilio feature listing](https://www.twilio.com/en-us/messaging/channels/whatsapp?locale=en).

## 2. Decide the permissible workflow honestly

WhatsApp's governing policy restricts facilitating medicine/healthcare-product exchange. Rwanda is absent from its listed OTC-promotion exception; the exceptions do not permit regulated-goods commerce. It also addresses customer-chat forwarding and sensitive information. Written provider clarification is needed on the precise client-to-ten-pharmacies arrangement, including the pharmacies' role. This policy issue is not the proven cause of V4's rejection. [WhatsApp Business Messaging Policy, sections 3–5](https://business.whatsapp.com/policy).

| Option | What changes | Decision |
| --- | --- | --- |
| Requested image ordering in WhatsApp | Photos, customer number and request sent to up to ten eligible pharmacies | Implement only if the precise activity is permitted and privacy gates are met |
| Secure web request + pharmacy portal + limited WhatsApp notifications | Sensitive detail stays behind authenticated request-specific access; WhatsApp carries only permitted notices | Preferred risk-reduction fallback, but notification/referral activity itself still needs assessment |
| Cloudflare portal only for medicine requests | Clients upload to the website; pharmacies use their dashboard; no WhatsApp medicine-order dispatch | Fallback if related WhatsApp activity is not permitted; requires owner approval |
| Another BSP or direct Meta API | Transport migration and additional operational work | Does not remove WhatsApp rules; not recommended as a policy remedy |

Do not rename a prescription order “support” to conceal it, submit misleading sample content, or hide prohibited links behind a redirect. Reviewers should see the real journey, a redacted example, the recipient-consent model and intended data retention. A secure portal reduces exposure; it is not a loophole.

## 3. Fix media transport first

Verified local sources: `worker/backend/private-media-response.ts`, `worker/backend/r2-media.ts`, and media-grant methods in `worker/backend/whatsapp-repository.ts`.

Ordinary WhatsApp images have a 5 MB limit; JPEG/PNG are suitable, while WebP is documented for stickers. Twilio also validates media with GET and HEAD. A generic 16/20 MB channel limit must not replace the image-specific limit. [WhatsApp media guidance](https://www.twilio.com/docs/whatsapp/guidance-whatsapp-media-messages?display=embedded), [Twilio media fetch requirements](https://www.twilio.com/docs/messaging/guides/accepted-mime-types).

Proposed changes:

- Support authenticated-by-opaque-grant HEAD and GET with matching Content-Type and Content-Length. HEAD must not expose the object without grant validation or consume the limited GET allowance.
- Normalize outgoing images to JPEG/PNG below a conservative 5,000,000-byte ceiling, preserving prescription legibility. Correct orientation and strip unnecessary metadata; set pixel/decompression limits. Do not infer or alter medical content.
- For a minimal first patch, reject unsupported/oversize images with a short actionable reply. Add automatic normalization only after selecting and testing a Cloudflare-compatible method; do not assume image transformation is free.
- Keep actual bytes, MIME type and outbound template image format consistent. The current `.png` path does not convert a JPEG or WebP. Serving JPEG with the correct JPEG header is not, by itself, proof of a MIME mismatch.
- Retain private R2 and expiring per-message/per-pharmacy grants. Validate the object before charging a successful-fetch allowance; handle concurrent fetches atomically. Choose a bounded retry allowance from controlled provider-fetch observations instead of assuming exactly two fetches is always sufficient.
- Cover missing objects, revoked/expired tokens, incorrect MIME, concurrent HEAD/GET, provider retry and oversized files. Do not make the bucket public to fix delivery.

These are compatibility risks demonstrated by code/documentation, not evidence that a particular live message failed for these reasons.

## 4. Make one image conversation one request

Proposed conditional workflow:

```text
Known pharmacy number → pharmacy-only actions and support
Other number → client draft → collect photos → Ready
  → saved/new native location → disclosure and Send request
  → freeze up to ten eligible recipients → queue attachments
  → per-recipient delivery status → truthful client update
```

### Identity and draft state

- Normalize phone numbers consistently; use the verified pharmacy registry, never a claimed role in message text. A number shared by multiple pharmacy branches needs an explicit account/branch rule, not arbitrary first-match access.
- Re-evaluate registry changes safely; revocation/opt-out must not turn a former pharmacy contact into a privileged client request path accidentally. Unknown numbers remain clients and cannot confirm pharmacy availability.
- Store one active draft per client, with explicit lifecycle/version and request-media rows. Separate sequential WhatsApp messages can belong to that same draft. Retry the same provider message without adding it twice; distinguish an intentional second photo from a transport replay.
- Seal the attachment set when the client finishes. If files are still downloading, wait rather than sending a partial bundle. Photos arriving after seal start a clearly identified new draft or prompt the user; they must not mutate an order already broadcast.
- Add bounded draft expiry, cancellation, stale-button detection and version-checked state transitions. Use D1 constraints/conditional updates and atomic batches; no new database service is needed.

### Native location, without maps links

Keep the manual WhatsApp location instruction the user chose. Capture Latitude/Longitude from the signed inbound webhook, validate ranges, timestamp the point and bind it to the correct draft. A static current-location message is not continuous tracking; Twilio says Live Location is unsupported and location details cannot later be recovered through its Message REST resource. [Twilio location receiving guidance](https://help.twilio.com/articles/360052128874-Can-I-share-my-location-or-receive-location-information-on-WhatsApp), [supported WhatsApp features](https://www.twilio.com/docs/whatsapp/message-features?display=embedded).

Offer reuse only when a saved point exists; show its label/date rather than implying it is the client's present position. Sharing a new location replaces the active request's point. Ask separately whether to save it for later; do not treat location receipt alone as permission for unrelated retention or disclosure.

### Exactly what “nearest ten” means

- Retain licence/verification/dispatch eligibility filtering; additionally require current WhatsApp opt-in and no suppression.
- Validate pharmacy coordinates as well as client coordinates. Sort by straight-line Haversine distance with deterministic ties. Do not call this road-travel time, current stock or guaranteed fulfilment.
- Resolve duplicate destination numbers and branch identity before selection. Snapshot up to ten unique eligible pharmacy recipients, their coordinates, distance/rank and eligibility evidence for the request.
- Never silently send to an eleventh pharmacy to compensate for failure. If fewer than ten qualify or receive the request, report the actual number.
- Queue a distinct attachment delivery per recipient/media pair with a unique dedupe key. For two images and ten pharmacies, twenty image messages still represent at most ten pharmacies.
- Count a pharmacy as receiving the complete request only when every required attachment has delivered/read evidence. Track partial bundles separately; do not let one successful photo conceal another missing photo.

Cloudflare Queues can deliver an item more than once. D1 outbox claims and dedupe are needed, and an ambiguous Twilio network result must be reconciled before retrying. Do not promise exactly-once external delivery. [Cloudflare delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

## 5. Complete the message family design

Design below is proposed copy, not approved provider content. Conditional medicine-related messages are deployable only after section 2 is resolved. Aim for two short sentences; physical line count cannot be guaranteed across phone sizes and fonts. Keep the user's explicit text-only manual-location exception.

Service messages need a per-recipient 24-hour check at actual send time, including queue retries. A client's conversation does not open a pharmacy's window. Approval is needed for business-initiated/out-of-window templates; the six existing families do not cover all failure and recovery paths. In-session quick replies can use up to three actions without prior approval. [Twilio session rules](https://www.twilio.com/docs/whatsapp/key-concepts?display=embedded), [quick-reply specification](https://www.twilio.com/docs/content/twilio-quick-reply).

| Family / purpose | Proposed short copy | Actions and behavior |
| --- | --- | --- |
| Draft/photos | “Received {{1}} images. Send another image or tap Ready.” | Ready / Cancel / Help; one draft, not one order per photo |
| First location | “We received your requests, please share your current location in WhatsApp:\nTap + or 📎 → Location → Send your current location” | No external maps button; retain approved manual instruction |
| Returning location | “We received your requests, please use your saved location or share a new one.” | Use saved / Share new; new sends the manual instruction |
| Pre-dispatch permission | “Share these {{1}} images and your WhatsApp number with up to 10 nearby eligible pharmacies?” | Send request / Cancel / Privacy; record notice version and response; full notice accessible |
| Optional saved point | “Save this location for your next request?” | Save location / Not now; separate from dispatch permission |
| Successful delivery | “Your request reached {{1}} nearby pharmacies. They can contact you directly on WhatsApp.” | Status / Help; in-session optional Share Med+250 only after referral design review |
| Partial/unknown delivery | “{{1}} pharmacies received your complete request. Delivery to {{2}} is still unconfirmed.” | Status / Help; later evidence updates the same request |
| None eligible | “No eligible pharmacy was found for this location. Your request was not sent.” | Share new / Help / Cancel |
| All delivery attempts failed | “We could not deliver your request to a pharmacy. Please contact support.” | Help / New request; do not automatically rebroadcast |
| Bad file / expired draft | Specific reason, e.g. “That image could not be sent. Please resend it as a clear JPG or PNG under 5 MB.” | Help / Cancel; draft expiry offers New request / Help |
| Pharmacy availability acknowledgment | “Availability recorded for request {{1}}. Please contact the customer to confirm details.” | View request / Help; authenticated view, assigned pharmacy only |
| STOP / HELP / cancellation | “WhatsApp notifications are stopped.” / “Your request is cancelled.” / verified support details | Suppression and cancellation take effect before acknowledgments; no unsolicited reminders |
| Authentication | Provider-required code format with Copy Code and short expiry | Separate Authentication template; rate limits, single use, no OTP logs |

Not every table row needs a separately approved Meta template: reusable in-session content definitions can cover guidance variants. Do not multiplex arbitrary text into a generic approved variable. Add minimal approved operational outcome templates only for genuine out-of-window needs, plus the two pharmacy dispatch families and Authentication. Recheck provider approval/category changes before production sending; fail closed when a required template is unusable.

### Pharmacy cards: exact requested labels and safe meaning

If image routing is permitted, a shorter candidate is:

> MED+250 request {{1}} · Image {{2}} of {{3}}.\nCustomer WhatsApp: {{4}} · Distance: {{5}} km.

Buttons: **Available** / **Not Available**. This is a new proposal with a new variable map, not a drop-in replacement for V4. If the owner retains the earlier three-line wording, preserve that copy and correct only the diagnosed provider issue.

Each action must resolve an assigned pharmacy + request + version from the existing compatible payload mechanism. Availability is not a completed sale, price quotation or clinical dispensing decision. Do not automatically mark every web-order item available or create a zero-price committed offer just because a pharmacy taps Available. Partial availability needs an explicit item-level web response.

For website orders, validate the **fully rendered** card, not just its medicine-summary variable. Keep each item intact; put the complete list, quantities and authorized product images in an authenticated detail view if it exceeds the limit. Twilio's WhatsApp card title maximum is 1,024 characters. Do not add a medicine catalogue in WhatsApp as a workaround. [Twilio card limits](https://www.twilio.com/docs/content/twiliocard).

### “Share Med+250” without an unreliable URL button

Preferred in-session design: **Share Med+250** quick reply → bot sends the MED+250 service contact card and a short, permitted invitation → user forwards the contact/message themselves. Twilio supports vCards. This does not automatically open a contacts chooser, send to friends, or imply those friends opted in. Test forwarding on real Android/iPhone WhatsApp before claiming it works. [Twilio vCard example](https://www.twilio.com/en-us/blog/send-vcard-twilio-whatsapp-node-js).

Keep referrals out of out-of-window Utility status templates. Do not preserve the old invitation promising medicine/prescription ordering unless that use case is permitted. A genuine web sharing page is another option, but introduces the web hop the user rejected; it is not the preferred design and must not be a disguised redirect.

## 6. Privacy and data-location gate

Cloudflare-only does not mean Rwanda-resident. D1 explicitly does not run in Africa; its location hints are not guarantees. R2 does not offer a Rwanda jurisdiction guarantee in its documented location controls. Database locality also does not by itself constrain all Worker processing. [D1 locations](https://developers.cloudflare.com/d1/configuration/data-location/), [R2 locations](https://developers.cloudflare.com/r2/reference/data-location/).

Rwanda's official law publication sets an external-storage authorization requirement in Article 50; Articles 48–49 separately address transfers and contracts. Whether MED+250 already has suitable registration/authorization and safeguards was not checked. This is an evidence gate, not an allegation of unlawful operation. [DPP Law, Articles 48–50](https://dpo.gov.rw/dpp-law/sharing-transferstorage-and-retention-of-personal-data), [official Gazette text](https://dpo.gov.rw/fileadmin/DPO/Law_relating_to_the_protection_of_personal_data_and_privacy.pdf).

Before activation, inspect the existing controller/processor registration, approved countries/providers and relevant contracts with Cloudflare/Twilio and pharmacies. Have a qualified Rwanda reviewer confirm the legal basis for health-data processing, disclosure and retention, including minors and persons submitting someone else's prescription. The official law treats consent, sensitive-data processing and safeguards separately. [DPP Law, Articles 4–17](https://dpo.gov.rw/dpp-law/processing-and-quality-of-personal-data).

Proposed technical controls:

- Record pharmacy messaging opt-in separately from verified telephone ownership; enforce STOP centrally across queues and retries.
- Make recipient disclosure explicit before the first broadcast. Collect no patient information beyond the request's need; do not forward exact coordinates if a distance/routing value is sufficient.
- Separate the saved-location preference from current-request permission; allow replacement/deletion. Store notice version, scope, timestamp and withdrawal without logging prescriptions or raw secrets.
- Apply role-based request access, auditable disclosure recipients, a reviewed retention/deletion schedule, short-lived delivery URLs, no public R2/patient images and redacted operations logs.
- Include Twilio-held message/media copies and pharmacy handling in retention planning. Revoking an R2 URL cannot erase a photo already delivered to someone's WhatsApp.
- If legally required residency cannot be satisfied by the existing authorization, stop the affected processing and obtain direction; there is no code flag that places D1 in Rwanda.

## 7. Implementation order and acceptance criteria

These are bounded work packages after implementation authorization. Safe engineering can proceed while support reviews the provider issue; activation of affected flows remains gated.

| Priority | Files / responsibility | Required acceptance evidence |
| --- | --- | --- |
| P0 provider diagnosis | `scripts/twilio-whatsapp-setup.mjs`, provider status report | Exact rejection reason; account/WABA match; approved intended dispatch/OTP SIDs; no blind sender/template deletion |
| P0 media compatibility | `worker/backend/private-media-response.ts`, `r2-media.ts`, grant methods/tests | HEAD/GET correctness; supported bytes/MIME/size; expiry/retry/concurrency tests; real provider fetch only with approved controlled test |
| P1 draft + location + permissions | `whatsapp-runtime.ts`, `whatsapp-repository.ts`, additive D1 migration | Two photos = one request; retries dedupe; no premature send; saved/new point; cancellation; separate permission records |
| P1 routing + finality | `dispatch-repository.ts`, outbox/repository/finality tests | Frozen unique top-ten set; fewer-than-ten cases; full-bundle distinct-pharmacy counts; partial/failed/unknown outcomes |
| P1 messaging registry + windows | `twilio-send.ts`, `runtime-env.ts`, `outbox-runtime.ts`, setup manifest | All family/action mappings; correct live SIDs; expiry at send time; no unapproved fallback; short copy and full rendered-length tests |
| P1 pharmacy actions + safety | Runtime/repository and pharmacy web order view | Authorized request-bound buttons; Available not equal fulfilment; no unpriced committed offer; valid support route |
| P1 operational privacy | D1 records, retention jobs, access tests and legal evidence register | Opt-out suppression, access isolation, deletion coverage and reviewed external-storage/transfer evidence |
| Final production release | Existing Worker only; no staging or new database provider | Exact deployed revision/bindings read back, tests green, approved controlled real-phone test and rollback evidence |

### Production verification that actually proves the routing

1. Back up the current configuration and establish a reversible, additive migration/release path. Preserve unrelated worktree changes and sender registration.
2. Validate locally with fixtures for normal flow, duplicate webhooks/queue delivery, concurrent photos, rejected media, expired session, invalid location, no eligible pharmacy, all failures, partial bundle and late/out-of-order callbacks. Never use real prescriptions as fixtures.
3. Before production activation, verify exact template statuses, variables, sender/WABA, callback URLs/signatures and gated behavior. Read back deployed source provenance; the earlier declared release variable differed from local HEAD.
4. With explicit test authorization and consenting recipients, send a clearly labelled non-patient test through the actual production sender. Start with authorized test recipients, then run the top-ten proof against the real eligible registry if the use case and all recipients permit it. Do not present an allowlisted canary as proof of the real top ten.
5. Capture the input point, eligible ranked snapshot, selected distinct recipients, per-image outbox rows, provider Message SIDs, delivered callbacks and the computed complete-request count. Independently compare selection to a reference distance calculation.
6. Verify both photos render, labels are exact, saved/new location works, action responses attach to the correct pharmacy/request and Share forwarding behaves on iOS/Android. Human review confirms readable images; delivery callbacks alone do not establish a pharmacist read or can supply a medicine.
7. Enable the authorized production flow only after these gates; monitor actual failures and retain a kill switch. A rollback should stop new dispatch safely without deleting evidence or re-sending queued requests.

Do not promise all ten pharmacies will receive or respond. The system can select up to ten, attempt delivery and accurately report what happened.

## 8. Cost consequence

Twilio lists $0.005 per incoming/outgoing WhatsApp message, plus applicable Meta fees. At that rate, one image to ten pharmacies costs $0.05 in Twilio outbound handling; two images cost $0.10. For 1,000 two-image requests, that dispatch component alone is $100—not the whole bill. Client prompts, button replies, authentication, provider fees and Cloudflare usage are additional. This arithmetic assumes one outbound message per image per pharmacy, not a verified invoice. [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing).

A permitted single portal notification per pharmacy can reduce attachment-message volume, but changes the requested user experience. Measure before choosing; do not introduce a new monthly database subscription or a paid verification product unnecessarily.

## Conclusion

The next concrete step is **retrieve the exact approval errors, then implement the media/draft/finality/window fixes against one reviewed message registry**. A platform-policy answer and data-protection evidence determine which flow can be activated. More template copies alone cannot deliver a reliable or appropriate service.

This research created documentation only. It did not edit application code, submit a template, send a support reply, alter secrets, deploy a Worker or dispatch a real order. The Cloudflare skill kept the design on the existing stack; the legal-authority-check skill separated official source verification from unresolved application to MED+250.

## Sources and authority status

- Documents relied on: earlier 2 September audit; named local source files; the current-turn synthetic HEAD result; official Twilio, WhatsApp, Cloudflare and Rwanda DPO publications linked at the relevant findings.
- Legal authorities relied on: official Rwanda DPP Law text, Articles 4–17 and 48–50. See [authority_index.csv](authority_index.csv). OFFICIAL_SOURCE_CHECKED means the cited official publication was checked, not that all amendments or the project's compliance were certified.
- Authorities not yet verified: any additional sector-specific dispensing/licensing rules, later applicable instruments or organization-specific authorizations; no complete legal currentness opinion or citator check was performed.
- Assumptions: Rwanda-facing service; existing Cloudflare/Twilio architecture remains the chosen stack; pharmacies are independent recipients rather than MED+250 staff; exact legal roles require confirmation.
- Missing facts: actual V4 rejection reason, fresh provider states, written determination on the precise workflow, pharmacy opt-ins/contracts, MED+250 registration/external-storage authorization, retention decisions and physical-phone results.
- Human review required before use: YES—qualified Rwanda privacy/health-sector reviewer for legal application, and authorized owner/provider review for activation.

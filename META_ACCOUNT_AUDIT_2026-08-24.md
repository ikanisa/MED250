# MED250 Meta production cutover audit

Status at baseline: **NOT_READY**.

The production number `+1 662-222-0600` is connected to WABA `1188521970082273` with high quality, and its display name currently shows **In Review**. The current Worker uses Twilio for outbound, inbound and delivery receipts. Cloudflare has no direct Meta runtime credential. By product-owner direction, MED250 will reuse an existing portfolio app instead of creating a new app.

The authorized target is one production provider: direct Meta Cloud API for WhatsApp transport, with Cloudflare Workers, D1, R2 and Queues remaining the only MED250 backend stack. After read-only comparison of the existing apps, `Emateli Vendor` (`1075514900370567`) is the lowest WhatsApp blast-radius candidate, subject to explicit acceptance of its unrelated login, Instagram and legal-policy configuration.

## Release gates

1. Confirm reuse of existing app Emateli Vendor after reviewing its login, Instagram, legacy policy and callback impact.
2. Deploy a raw-body HMAC-verified Meta webhook and native `location_request_message` sender.
3. Install a least-privilege system-user credential through a secret-only handoff.
4. Verify the webhook challenge before moving the number.
5. Migrate the phone without dual-provider routing.
6. Verify image intake, one-tap native location, saved/new location, nearest-10 dispatch, pharmacy reply buttons, OTP and delivery/read receipts on physical devices.
7. Retain Cloudflare version `912982d3-c4eb-4a81-ab93-3640523c2e79` as rollback evidence until UAT passes.

No connected phone, app creation, webhook challenge or accepted API response is sufficient by itself to call this cutover complete.

## Progress snapshot at 2026-08-24T08:50:45Z

- `med250_pharmacy_image_request_v1` (template `1773644937239346`) is **Active - Quality pending**.
- `med250_whatsapp_otp_v1` (template `2206355629937444`) is **Active - Quality pending**.
- `med250_pharmacy_order_v1` (template `1068627845813387`) remains **In review**.
- The direct Meta send, signed webhook, private-media download, native WhatsApp location request, saved/new location choice and nearest-pharmacy dispatch paths are implemented and pass local type and focused test checks.
- No Worker deployment or routing cutover has been performed.

## Provider restriction update at 2026-08-24T11:08:05Z

Administrator 2FA completed and Assigu visibly shows business verification complete with the user holding full access to everything. The confirmed `MED250 Service Center` app creation reached the final Meta for Developers submission with the WhatsApp use case and Assigu ownership, but Meta rejected the live write with **Your account is restricted right now** and **You have been temporarily blocked from performing this action**. No app ID or credential was created. The only listed Required Action concerns Emateli data-access renewal due October 3, 2026 and is not evidence of the MED250 creation restriction's cause.

Authenticated Business Support Home readback shows Assigu and the visible WhatsApp/data-source assets without reported account issues, but it exposes no appeal or review control for this developer-account creation block. The Chrome creation tab is preserved at the restriction dialog for administrator review.

## Existing-app reuse update at 2026-08-24T11:18:08Z

The product owner instructed Codex not to create a new Meta app and to reuse an existing one. `IKANISA` (`3769557166649385`) was the preliminary name-matched candidate and already includes the WhatsApp product, but it is not currently ready for the MED250 production number:

- Its API Setup does not list `+1 662-222-0600`; it lists a Meta test number and four unrelated ICUPA/Lifuti/IKANISA numbers.
- Its subscribed `messages` webhook currently points to `https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/whatsapp-webhook`, which conflicts with the Cloudflare-only requirement.
- Business Settings shows no connected assets for the IKANISA app.
- Its basic settings contain legacy Emateli privacy/terms URLs and Malta DPO data.
- Production WABA `1188521970082273` is named `easyMO`; Twilio, Inc. has full-control partner access and supplies its credit line.
- The production phone remains Connected with High quality and its display name is In Review.

No app, WABA, callback, token, partner assignment or provider route was changed during this assessment. The next write must be a controlled shared-app and provider-routing change with explicit action-time confirmation.

## Existing-app comparison update at 2026-08-24T11:33:39Z

The existing apps were compared by WhatsApp capability, live subscriptions, phone assignments, connected assets, product overlap and legal metadata:

- `IKANISA` (`3769557166649385`) and `Assigu` (`3298479527117404`) actively subscribe `messages` to Supabase and show the unrelated ICUPA, Lifuti and IKANISA numbers. Assigu also has an ad account connected.
- `ASSIGU` (`1416487735910675`) has no connected assets and is unpublished, but its Add use cases screen does not offer WhatsApp.
- `ASSIGU` (`431495622649422`) is a Consumer app, so it is not a valid WhatsApp Business app candidate.
- `Emateli Vendor` (`1075514900370567`) already has WhatsApp, shows no production phone or WABA, has no connected business assets, and its `messages` field is unsubscribed. It therefore has the lowest immediate WhatsApp-routing blast radius.
- Emateli Vendor is not isolated: Facebook Login and Instagram Graph API are present, its callback points to a Supabase function, and its privacy and terms fields point to Emateli/Google Play material.

The recommended existing-app candidate is therefore Emateli Vendor, not IKANISA. This is a recommendation only: no app selection, webhook, WABA, credential or provider route was changed.

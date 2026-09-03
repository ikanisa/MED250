# Partner location-confirmation outreach — authorized preflight

**Superseded interpretation, 3 September 2026:** the owner clarified that partners physically approved the initial outreach and its official opt-in button is for future alerts. The zero START-ledger count below is historical, not evidence that no initial permission exists. See [the clarified one-time outreach release](partner-location-release-2026-09-03.md). No historic recipient event or date has been invented.

Live production check started at **2026-09-02T21:23:42.025Z** (23:23 Kigali). The user approved a short WhatsApp location-confirmation request **to existing opted-in partners only**, to resolve missing or conflicting GPS. This approval is operator authorization, not a recipient opt-in or authorization to broaden the recipient set.

## Result

**No messages sent: zero eligible opted-in recipients.** Authenticated, read-only Cloudflare D1 queries against `med250-production` returned:

| Check | Live result |
| --- | ---: |
| Active recorded WhatsApp contacts | 280 |
| WhatsApp contacts with `messaging_opt_in_at` populated, including inactive contacts | 0 |
| Active opted-in contacts with unverified GPS and no recorded opt-out | 0 |
| Granted `pharmacy_notifications` permission events | 0 |
| All recipient-permission ledger rows | 0 |
| Unrevoked owner-attested initial permissions | 136 |
| Historical dispatch outbox rows | 48 |

The contact opt-in-source grouping was empty, as was the complete recipient-permission-purpose grouping. Therefore the zero-recipient result does not depend on excluding particular GPS states, contact flags or opt-in sources. No destinations were selected and no provider send was attempted. Provider template approval was not rechecked: there was no permitted recipient to send to, and no template approval is claimed by this preflight.

The 136 remaining owner-attested initial permissions bind an initial client-request notification under the existing order workflow. They were not spent, repurposed or converted into recurring/location-follow-up consent. Public-directory numbers and verified GPS are not recipient opt-in evidence.

## Message draft — not submitted or sent

> MED+250: please confirm your business location so nearby requests reach the correct branch.
> While at your premises, tap + or 📎 → Location → Send your current location.

This is a proposed two-line administrative request, not an approved provider template. Sending outside an available conversation window will require a suitable approved message definition. No template was created or submitted in this check, and no automatic pharmacy-GPS update on reply is claimed.

## Next permitted path

A willing registered partner can send **START** from its registered WhatsApp number to **+1 662-222-0600** using [the partner initiation link](https://wa.me/16622220600?text=START). Opening the link is not enough: the partner must send the message. The current inbound handler in `worker/backend/whatsapp-conversation.ts` records the signed START event, a `pharmacy_notifications` permission event and the matching contact opt-in; STOP clears permission and suppresses pending sends. This behavior was inspected in source, not newly exercised with a real partner in this preflight.

Alternatively, existing recipient agreement evidence can be reviewed and recorded through an evidence-backed import. Do not fabricate START events, recipient dates or consent evidence. Once recipients qualify, recheck the exact business/contact match, opt-outs, send history, suitable content and reply-capture handling before sending. Do not broaden this approval to the full public contact list.

## Boundaries

Cloudflare skill guidance was used for live read-only D1 checks and separation of permission types. No production rows, consent flags, initial permissions, secrets, templates, deployments or dispatch settings were changed. No emails, WhatsApp messages, test orders or fabricated inbound events were sent. Only this local audit and the research report's current-status note were updated; unrelated worktree changes were preserved.

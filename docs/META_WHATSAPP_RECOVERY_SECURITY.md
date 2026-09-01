# MED250 direct-Meta recovery containment

MED250 production uses Twilio Programmable Messaging through the canonical
Cloudflare Worker. The Supabase `whatsapp-webhook` and
`dispatch-whatsapp-notifications` functions are historical recovery surfaces,
not an alternate active provider route. Their webhook and send gates therefore
default to false.

The repository references Supabase project `uskfnszcdqpcfrhjxitl`. The retained
Meta audit also observed an IKANISA-app `messages` subscription pointing at that
project even though MED250's production sender is WABA `1188521970082273`, phone
ID `900256399838407`, and Twilio remains its provider. These identifiers show a
cross-product routing conflict; they do not authorize reuse or prove the source
currently deployed at the callback.

Before either recovery function can be considered for activation:

1. Read back the current callback, subscriptions, traffic, deployed function
   revision, project owner, secret owner and retention state.
2. Confirm one exact MED250 app, WABA, phone, template set, Graph version,
   provider, release owner and rollback owner. Remove the stale callback when it
   is unused; do not run Twilio and Meta concurrently for the same phone.
3. Apply `20260828090000_med250_meta_gateway_security.sql`, read back tables,
   functions, RLS and grants, and install independent secret values without
   exposing them in evidence.
4. Keep both flags false while invalid/missing signature, wrong WABA, wrong
   phone, wrong country, oversize, replay, digest conflict, rate, database
   failure, status reordering, retention and rollback tests run.
5. If direct Meta is deliberately selected in the future, enable one function
   at a time only under exact action-time approval and complete physical-device
   inbound, outbound, media, location, OTP, delivery/read, failure and rollback
   UAT before routing production traffic.

Rollback starts by setting both flags false. Preserve legitimate delivery and
security receipts, then restore only a verified prior revision. Never retain
tokens, app secrets, verification tokens, raw webhook bodies, message content,
phone numbers or OTPs in test evidence.

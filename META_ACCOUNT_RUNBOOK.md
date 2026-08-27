# MED250 Meta account runbook

## Daily

- Review sender connection, display-name status, quality, messaging limits and webhook failures.
- Halt automated delivery on token, signature, rate-limit or provider ownership errors.
- Review failed and unknown outbox sends without exposing client content in logs.

## Weekly

- Reconcile sent, delivered, read and failed receipts against D1.
- Review opt-out, blocked-user and pharmacy-response failures.
- Confirm the authorized existing app, WABA, phone and Cloudflare Worker remain the production route, and that the app's unrelated products were not disrupted.

## Monthly

- Review people, system users, app permissions, WABA assets and credential ownership.
- Rotate credentials according to the recorded policy using a manual secret handoff.
- Test privacy, deletion and private-media retention controls.

## Quarterly

- Review least privilege, business verification, app access, data-use requirements and incident response.
- Exercise provider rollback without sending customer messages.

## Incident containment

1. Stop new outbox claims.
2. Preserve provider receipts and D1 audit evidence.
3. Revoke the affected credential in Meta and Cloudflare without printing it.
4. Roll back the Worker only if provider ownership and webhook routing are still compatible.
5. Resume after signed inbound and controlled outbound UAT pass.

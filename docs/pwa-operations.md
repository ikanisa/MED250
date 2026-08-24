# MED+250 PWA operations

## Cache and data boundary

- `med250-marketplace-static-v4` stores only same-origin hashed application assets and public brand/marketplace images.
- `med250-marketplace-pages-v4` stores a bounded set of public navigation responses for offline reading.
- `med250-marketplace-public-media-v4` stores only the public catalogue media endpoint when its response explicitly permits public caching.
- Cache reads are scoped to these exact MED+250 stores so another PWA sharing a development origin cannot supply stale pages or assets.
- Authentication, orders, pharmacy workspaces, internal APIs, WhatsApp routes, prescriptions, private media, request deep links, portal deep links, token-bearing URLs, `private`, and `no-store` responses are never written to Cache Storage.
- Offline mutations are intentionally disabled. MED+250 never reports an availability request as sent until the server records it.

## Update lifecycle

The service worker installs without forcing the active tab to reload. When a new worker is waiting, MED+250 offers an explicit Update action. The notice is suppressed while a request, order status, pharmacy sign-in, pharmacy workspace, or pharmacy response editor is open. Dismissing an update defers the notice for six hours.

## Routine verification

1. Load a public route online, then confirm `sw.js` controls the page.
2. Reload the same public route offline and confirm cached content or `offline.html` is shown.
3. Confirm live search and availability requests fail closed while offline.
4. Open the request basket or pharmacy workspace and confirm an update notice is not shown.
5. Deploy a new worker version, confirm the update notice appears outside a sensitive workflow, and confirm the page reloads only after Update is chosen.
6. Confirm old `med250-` cache versions are removed after activation and each active cache stays within its documented entry limit.

## Corrupted-cache recovery

From a controlled same-origin diagnostic page or browser developer console, send `{ type: "CLEAR_MED250_CACHES" }` to the active service-worker controller. Wait for `MED250_CACHES_CLEARED`, then reload while online. The browser will recreate only the current versioned caches.

## Emergency kill switch

1. Replace `/sw.js` with a minimal same-origin worker that deletes every cache whose name starts with `med250-`, calls `self.registration.unregister()`, and reloads or navigates controlled clients to the network version only after any active request/pharmacy workflow is closed.
2. Serve the replacement `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate`.
3. Deploy through the normal controlled release path and verify the exact production revision before asking users to reload.
4. Keep the application network-usable without a service worker; do not remove the replacement worker until existing installations have received it.

Never use the kill switch to bypass release approval, an active form, payment, prescription, request, or pharmacy transaction.

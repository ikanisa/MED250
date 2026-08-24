import assert from "node:assert/strict";
import test from "node:test";

import { locationPageResponse } from "../worker/backend/location-page.ts";
import {
  createOpaqueToken,
  sha256Hex,
  signClientLocationToken,
  verifyClientLocationToken,
} from "../worker/backend/secure-token.ts";

const actorId = "00000000-0000-4000-8000-000000000101";
const requestId = "00000000-0000-4000-8000-000000000102";
const secret = "test-only-location-link-secret-with-at-least-32-bytes";

test("signs short-lived audience-specific location claims and rejects tampering or expiry", async () => {
  const token = await signClientLocationToken({ actorId, requestId }, secret, 10_000);
  const verified = await verifyClientLocationToken(token, secret, 10_001);
  assert.equal(verified?.actorId, actorId);
  assert.equal(verified?.requestId, requestId);
  assert.equal(verified?.expiresAt, 10_900);
  const [claims, signature] = token.split(".");
  const signatureReplacement = signature.startsWith("A") ? "B" : "A";
  assert.equal(await verifyClientLocationToken(`${claims}.${signatureReplacement}${signature.slice(1)}`, secret, 10_001), null);

  // A 32-byte signature has four possible final base64url characters for the
  // same decoded bytes unless unused bits are required to be zero. Exercise
  // that exact malleability case deterministically.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalIndex = alphabet.indexOf(signature.at(-1));
  assert.equal(finalIndex % 4, 0);
  const nonCanonicalSignature = `${signature.slice(0, -1)}${alphabet[finalIndex + 1]}`;
  assert.equal(await verifyClientLocationToken(`${claims}.${nonCanonicalSignature}`, secret, 10_001), null);
  assert.equal(await verifyClientLocationToken(token, secret, 10_901), null);
});

test("creates non-predictable 256-bit media grants without embedding database identifiers", async () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal((await sha256Hex(first)).length, 64);
  assert.doesNotMatch(first, /00000000/);
});

test("renders a no-store consent map and accepts only token-bound Rwanda coordinates", async () => {
  const token = await signClientLocationToken({ actorId, requestId }, secret);
  const getResponse = await locationPageResponse(
    new Request(`https://med-250.com/whatsapp/location?token=${token}`),
    null,
    secret,
  );
  assert.equal(getResponse?.status, 200);
  assert.equal(getResponse?.headers.get("cache-control"), "private, no-store");
  const html = await getResponse.text();
  assert.match(html, /Confirm and dispatch request/);
  assert.match(html, /up to 10 verified nearby pharmacies/);
  assert.match(html, /openstreetmap\.org\/export\/embed/);

  let saved = null;
  const repository = {
    async saveLocation(input) {
      saved = input;
      return { locationId: "00000000-0000-4000-8000-000000000103", recipientCount: 7 };
    },
  };
  const postResponse = await locationPageResponse(
    new Request("https://med-250.com/api/whatsapp/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, latitude: -1.95, longitude: 30.06, accuracyM: 12 }),
    }),
    repository,
    secret,
  );
  assert.equal(postResponse?.status, 200);
  assert.deepEqual(await postResponse.json(), { saved: true, recipientCount: 7 });
  assert.equal(saved.actorId, actorId);
  assert.equal(saved.requestId, requestId);
  assert.equal(saved.source, "secure_webview");
  assert.equal(saved.captureKeyHex.length, 64);

  const outside = await locationPageResponse(
    new Request("https://med-250.com/api/whatsapp/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, latitude: 40, longitude: 30.06, accuracyM: 12 }),
    }),
    repository,
    secret,
  );
  assert.equal(outside?.status, 400);
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolveGoogleMapsLocation } from "../worker/backend/google-maps-location.ts";
import { createOpaqueToken, sha256Hex } from "../worker/backend/secure-token.ts";

test("creates non-predictable 256-bit media grants without embedding database identifiers", async () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal((await sha256Hex(first)).length, 64);
  assert.doesNotMatch(first, /00000000/);
});

test("extracts a Rwanda pin from an official Google Maps share URL", async () => {
  const resolved = await resolveGoogleMapsLocation(
    "My delivery pin: https://www.google.com/maps/place/Kigali/@-1.9440727,30.0618851,17z",
  );
  assert.equal(resolved.matched, true);
  assert.deepEqual(resolved.location && {
    latitude: resolved.location.latitude,
    longitude: resolved.location.longitude,
  }, { latitude: -1.9440727, longitude: 30.0618851 });
});

test("follows only allow-listed Google Maps redirects and does not read response bodies", async () => {
  const calls = [];
  let cancelled = false;
  const resolved = await resolveGoogleMapsLocation(
    "https://maps.app.goo.gl/med250-test",
    async (url, init) => {
      calls.push({ url: String(url), redirect: init.redirect });
      return new Response(new ReadableStream({
        cancel() { cancelled = true; },
      }), {
        status: 302,
        headers: { location: "https://www.google.com/maps/place/Delivery/@-1.9536,30.0606,18z" },
      });
    },
  );
  assert.equal(resolved.matched, true);
  assert.equal(resolved.location?.latitude, -1.9536);
  assert.equal(resolved.location?.longitude, 30.0606);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, "manual");
  assert.equal(cancelled, true);
});

test("rejects non-Google URLs, off-platform redirects and coordinates outside Rwanda", async () => {
  assert.deepEqual(
    await resolveGoogleMapsLocation("https://example.com/maps/@-1.95,30.06,17z"),
    { matched: false, location: null },
  );
  assert.deepEqual(
    await resolveGoogleMapsLocation("https://www.google.com/maps/@37.7749,-122.4194,17z"),
    { matched: true, location: null },
  );
  const redirected = await resolveGoogleMapsLocation(
    "https://maps.app.goo.gl/unsafe",
    async () => new Response(null, { status: 302, headers: { location: "https://example.com/@-1.95,30.06" } }),
  );
  assert.deepEqual(redirected, { matched: true, location: null });
  assert.deepEqual(
    await resolveGoogleMapsLocation("https://www.google.com/maps/place/%E0%A4%A"),
    { matched: true, location: null },
  );
});

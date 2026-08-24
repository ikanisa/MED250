import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ingestTwilioImage, MediaIngestError } from "../worker/backend/r2-media.ts";

const accountSid = `AC${"0".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const messageSid = "MM00000000000000000000000000000003";
const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/ME00000000000000000000000000000003`;

class MemoryR2Bucket {
  objects = new Map();

  async get(key) {
    const found = this.objects.get(key);
    if (!found) return null;
    return {
      key,
      etag: found.etag,
      size: found.bytes.length,
      httpMetadata: found.options.httpMetadata,
      customMetadata: found.options.customMetadata,
      body: new Response(found.bytes).body,
    };
  }

  async put(key, value, options) {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const etag = createHash("md5").update(bytes).digest("hex");
    this.objects.set(key, { bytes, options, etag });
    return { key, etag, size: bytes.length };
  }
}

function jpegResponse(bytes, contentType = "image/jpeg") {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes.length) },
  });
}

function input(bucket, fetcher, overrides = {}) {
  return {
    bucket,
    accountSid,
    authToken: "non-live-test-token",
    mediaUrl,
    contentType: "image/jpeg",
    requestId,
    messageSid,
    mediaIndex: 0,
    fetcher,
    ...overrides,
  };
}

test("streams a validated Twilio image into an immutable private R2 key", async () => {
  const bucket = new MemoryR2Bucket();
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6];
  let authorization = "";
  const result = await ingestTwilioImage(input(bucket, async (_url, init) => {
    authorization = new Headers(init.headers).get("authorization") ?? "";
    return jpegResponse(bytes);
  }));

  assert.match(authorization, /^Basic /);
  assert.equal(result.key, `client-requests/${requestId}/${messageSid}-0.jpg`);
  assert.equal(result.byteSize, bytes.length);
  assert.equal(result.sha256, createHash("sha256").update(Uint8Array.from(bytes)).digest("hex"));
  assert.equal(bucket.objects.get(result.key).options.httpMetadata.cacheControl, "private, no-store");
});

test("follows a Twilio media redirect without forwarding the account credential", async () => {
  const bucket = new MemoryR2Bucket();
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
  const calls = [];
  const result = await ingestTwilioImage(input(bucket, async (url, init) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init.headers).get("authorization"),
      redirect: init.redirect,
    });
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://media.twiliocdn.com/signed/client-image" },
      });
    }
    return jpegResponse(bytes);
  }));

  assert.equal(calls.length, 2);
  assert.match(calls[0].authorization, /^Basic /);
  assert.equal(calls[0].redirect, "manual");
  assert.equal(calls[1].authorization, null);
  assert.equal(calls[1].url, "https://media.twiliocdn.com/signed/client-image");
  assert.equal(result.byteSize, bytes.length);
});

test("rejects an insecure Twilio media redirect", async () => {
  const bucket = new MemoryR2Bucket();
  await assert.rejects(
    ingestTwilioImage(input(bucket, async () => new Response(null, {
      status: 302,
      headers: { location: "http://example.com/client-image" },
    }))),
    (error) => error instanceof MediaIngestError && error.code === "unsafe_media_redirect",
  );
  assert.equal(bucket.objects.size, 0);
});

test("rejects spoofed image bytes and leaves no R2 object", async () => {
  const bucket = new MemoryR2Bucket();
  await assert.rejects(
    ingestTwilioImage(input(bucket, async () => jpegResponse([1, 2, 3, 4]))),
    (error) => error instanceof MediaIngestError && error.code === "image_signature_mismatch",
  );
  assert.equal(bucket.objects.size, 0);
});

test("rejects an oversized Twilio response before storing bytes", async () => {
  const bucket = new MemoryR2Bucket();
  const bytes = new Array(1025).fill(0);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  await assert.rejects(
    ingestTwilioImage(input(bucket, async () => jpegResponse(bytes), { maxBytes: 1024 })),
    (error) => error instanceof MediaIngestError && error.code === "media_too_large",
  );
  assert.equal(bucket.objects.size, 0);
});

test("recovers an already-written deterministic object without overwriting or redownloading", async () => {
  const bucket = new MemoryR2Bucket();
  let downloads = 0;
  const fetcher = async () => {
    downloads += 1;
    return jpegResponse([0xff, 0xd8, 0xff, 1, 2, 3]);
  };
  await ingestTwilioImage(input(bucket, fetcher));
  const recovered = await ingestTwilioImage(input(bucket, fetcher));
  assert.equal(recovered.recovered, true);
  assert.equal(downloads, 1);
  assert.equal(bucket.objects.size, 1);
});

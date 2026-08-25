import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function serviceWorkerContext() {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const context = vm.createContext({
    AbortController,
    Promise,
    Request,
    Response,
    URL,
    clearTimeout,
    console,
    fetch: async () => new Response("network"),
    setTimeout,
    caches: {
      async keys() { return []; },
      async match() { return undefined; },
      async open() {
        return {
          async addAll() {},
          async delete() { return true; },
          async keys() { return []; },
          async match() { return undefined; },
          async put() {},
        };
      },
    },
    self: {
      clients: { async claim() {} },
      location: { origin: "https://med-250.com" },
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() {},
    },
  });
  vm.runInContext(source, context, { filename: "public/sw.js" });
  return { context, listeners, source };
}

test("keeps sensitive MED+250 routes outside Cache Storage", async () => {
  const { context } = await serviceWorkerContext();
  const privateUrls = [
    "/api/auth/session",
    "/api/orders",
    "/api/pharmacy/requests",
    "/api/internal/health",
    "/api/twilio/whatsapp/status",
    "/pharmacies",
    "/pharmacy-prescription/private-token",
    "/whatsapp-client-media/private-token",
    "/whatsapp-order-media/private-token",
    "/?request=open",
    "/?pharmacy-portal=open",
    "/product/example?token=private-token",
  ];

  for (const path of privateUrls) {
    assert.equal(context.isPrivatePath(new URL(path, "https://med-250.com")), true, path);
  }
  assert.equal(context.isPrivatePath(new URL("/api/catalogue/media/product-1/1", "https://med-250.com")), false);
  assert.equal(context.isPrivatePath(new URL("/product/product-1", "https://med-250.com")), false);
});

test("stores only eligible same-origin public responses", async () => {
  const { context } = await serviceWorkerContext();
  const response = (cacheControl, type = "basic", ok = true) => ({
    ok,
    type,
    headers: new Headers({ "Cache-Control": cacheControl }),
  });

  assert.equal(context.responseCanBeStored(response("private, no-store")), false);
  assert.equal(context.responseCanBeStored(response("public, max-age=86400"), true), true);
  assert.equal(context.responseCanBeStored(response("max-age=86400"), true), false);
  assert.equal(context.responseCanBeStored(response("public, max-age=86400", "cors"), true), false);
  assert.equal(context.responseCanBeStored(response("public, max-age=86400", "basic", false), true), false);
});

test("does not intercept private fetches and exposes controlled cache recovery", async () => {
  const { listeners, source } = await serviceWorkerContext();
  const fetchListener = listeners.get("fetch");
  assert.equal(typeof fetchListener, "function");

  let intercepted = false;
  fetchListener({
    request: new Request("https://med-250.com/api/orders"),
    respondWith() { intercepted = true; },
  });
  assert.equal(intercepted, false);
  assert.match(source, /CLEAR_MED250_CACHES/);
  assert.match(source, /MED250_CACHES_CLEARED/);
  assert.doesNotMatch(source, /STATIC_SHELL = \[\s*"\/"/);
});

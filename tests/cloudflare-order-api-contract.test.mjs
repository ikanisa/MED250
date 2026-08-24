import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("protects web catalogue orders with verified client sessions, origin and CSRF checks", async () => {
  const [api, worker] = await Promise.all([
    read("../worker/backend/order-api.ts"),
    read("../worker/index.ts"),
  ]);
  assert.match(api, /assertMutationOrigin\(request, runtime\)/);
  assert.match(api, /requireSession\(request, new AuthRepository\(database\), "client", true\)/);
  assert.match(api, /session\.receipt\.actorType !== "client"/);
  assert.match(api, /whatsapp !== session\.receipt\.e164/);
  assert.match(worker, /orderResponse\(request, env\)/);
  assert.match(worker, /sweepDispatchOutbox\(env\)/);
});

test("bounds and authenticates private prescription uploads before immutable R2 persistence", async () => {
  const api = await read("../worker/backend/order-api.ts");
  assert.match(api, /PRESCRIPTION_LIMIT = 10 \* 1024 \* 1024/);
  assert.match(api, /readBodyBytes\(request, PRESCRIPTION_LIMIT\)/);
  assert.match(api, /validSignature\(type, bytes\)/);
  assert.match(api, /web-prescriptions\/\$\{session\.receipt\.principalId\}/);
  assert.match(api, /cacheControl: "private, no-store"/);
  assert.match(api, /sha256BytesHex\(bytes\)/);
  assert.match(api, /await bucket\.delete\(r2Key\)\.catch/);
});

test("keeps order creation database-backed, idempotent and location-bound", async () => {
  const [api, repository, client] = await Promise.all([
    read("../worker/backend/order-api.ts"),
    read("../worker/backend/order-repository.ts"),
    read("../lib/dawanear-client.ts"),
  ]);
  assert.match(api, /idempotencyHashHex: await sha256Hex\(canonical\)/);
  assert.match(api, /web-order-location:/);
  assert.match(repository, /med250_client_requests/);
  assert.match(repository, /atomicBatch\(this\.database, statements\)/);
  assert.match(repository, /dispatchToNearestPharmacies/);
  assert.match(client, /orderBackendConfigured = true/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_MED250_ORDER_BACKEND|Supabase|supabase|\.rpc\(/);
  assert.match(client, /\/api\/orders\/prescription/);
  assert.match(client, /prescription_media_id: prescriptionPath/);
  assert.match(client, /med250ApiJson\("\/api\/orders"/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeocodePayload,
  resolveGeocodeEndpoint,
  runGeocodeAdmin,
} from "../scripts/pharmacy-geocode-admin.mjs";

const pharmacyId = "11111111-1111-4111-8111-111111111111";
const environment = {
  MED250_OPERATOR_ORIGIN: "https://staging.med-250.com",
  MED250_ADMIN_TOKEN: "test-admin-token-that-must-not-print",
};

test("builds bounded candidate generation and exact inspection requests", () => {
  assert.deepEqual(buildGeocodePayload(["generate", "--batch-limit", "25"]), {
    action: "generate",
    batch_limit: 25,
  });
  assert.deepEqual(buildGeocodePayload(["inspect", "--pharmacy-id", pharmacyId]), {
    action: "inspect",
    pharmacy_id: pharmacyId,
  });
  assert.throws(() => buildGeocodePayload(["generate", "--batch-limit", "26"]), /1 to 25/);
});

test("does not permit batch or incomplete approval", () => {
  assert.throws(
    () => buildGeocodePayload(["approve", "--pharmacy-id", pharmacyId, "--batch-limit", "25"]),
    /Unsupported option/,
  );
  assert.throws(
    () => buildGeocodePayload(["approve", "--pharmacy-id", pharmacyId, "--google-place-id", "place-1"]),
    /reviewed-by/,
  );
});

test("sends the admin token only as a protected request header", async () => {
  let captured;
  const result = await runGeocodeAdmin(["inspect", "--pharmacy-id", pharmacyId], {
    environment,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ candidate: { pharmacy_id: pharmacyId } }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://staging.med-250.com/api/internal/operator/geocode");
  assert.equal(captured.init.headers.Authorization, `Bearer ${environment.MED250_ADMIN_TOKEN}`);
  assert.equal(JSON.parse(captured.init.body).action, "inspect");
  assert.deepEqual(result, { candidate: { pharmacy_id: pharmacyId } });
});

test("requires process-only credentials and an HTTPS Worker operator origin", async () => {
  await assert.rejects(
    runGeocodeAdmin(["inspect", "--pharmacy-id", pharmacyId], { environment: { MED250_OPERATOR_ORIGIN: environment.MED250_OPERATOR_ORIGIN } }),
    /MED250_ADMIN_TOKEN/,
  );
  assert.throws(
    () => resolveGeocodeEndpoint({ MED250_OPERATOR_ORIGIN: "http://localhost:8787" }),
    /HTTPS origin/,
  );
});

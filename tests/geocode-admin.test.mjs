import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeocodePayload,
  resolveGeocodeEndpoint,
  runGeocodeAdmin,
} from "../scripts/pharmacy-geocode-admin.mjs";

const pharmacyId = "11111111-1111-4111-8111-111111111111";
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://uskfnszcdqpcfrhjxitl.supabase.co",
  DAWANEAR_ADMIN_TOKEN: "test-admin-token-that-must-not-be-printed",
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
  assert.equal(captured.url, "https://uskfnszcdqpcfrhjxitl.supabase.co/functions/v1/geocode-pharmacies");
  assert.equal(captured.init.headers["X-DawaNear-Admin-Token"], environment.DAWANEAR_ADMIN_TOKEN);
  assert.equal(JSON.parse(captured.init.body).action, "inspect");
  assert.deepEqual(result, { candidate: { pharmacy_id: pharmacyId } });
});

test("requires process-only credentials and an HTTPS Supabase project origin", async () => {
  await assert.rejects(
    runGeocodeAdmin(["inspect", "--pharmacy-id", pharmacyId], { environment: { NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL } }),
    /DAWANEAR_ADMIN_TOKEN/,
  );
  assert.throws(
    () => resolveGeocodeEndpoint({ SUPABASE_URL: "http://localhost:54321" }),
    /HTTPS \*\.supabase\.co/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { loadCloudflareBuildEnvironment } from "../scripts/build-cloudflare-environment.mjs";

test("production builds derive every browser integration variable from wrangler config", async () => {
  const environment = await loadCloudflareBuildEnvironment("production");
  assert.equal(environment.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE, "live");
  assert.equal(environment.NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN, "https://med-250.com");
  assert.match(environment.NEXT_PUBLIC_SUPABASE_URL, /^https:\/\/[a-z]+\.supabase\.co$/);
  assert.match(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.match(environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY, /^0x4/);
});

test("the legacy Cloudflare build uses the same canonical live browser contract", async () => {
  const [legacy, production] = await Promise.all([
    loadCloudflareBuildEnvironment("gikundiro"),
    loadCloudflareBuildEnvironment("production"),
  ]);
  assert.deepEqual(legacy, production);
});

test("Cloudflare build wrapper rejects unknown environments", async () => {
  await assert.rejects(loadCloudflareBuildEnvironment("preview"), /Unsupported Cloudflare build environment/);
});

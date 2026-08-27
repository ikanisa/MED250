import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareWorkerD1Config,
  removeDevelopmentOnlyVars,
  requiredWorkerSecretNames,
} from "../scripts/prepare-worker-d1-config.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const databaseId = "123e4567-e89b-42d3-a456-426614174000";
const providerValues = {
  MED250_WHATSAPP_PROVIDER: "twilio",
  MED250_ADMIN_WHATSAPP: "250795588248",
  MED250_ALLOWED_ORIGINS: "https://med-250.com",
  TWILIO_WHATSAPP_FROM: "whatsapp:+16622220600",
  TWILIO_WHATSAPP_WEBHOOK_URL: "https://med-250.com/api/twilio/whatsapp/inbound",
  TWILIO_WHATSAPP_STATUS_CALLBACK_URL: "https://med-250.com/api/twilio/whatsapp/status",
  TWILIO_CLIENT_DISPATCH_CONFIRMATION_CONTENT_SID: "HX00000000000000000000000000000007",
  TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID: "HX00000000000000000000000000000001",
  TWILIO_CLIENT_LOCATION_CHOICE_CONTENT_SID: "HX00000000000000000000000000000002",
  TWILIO_CUSTOMER_OTP_CONTENT_SID: "HX00000000000000000000000000000003",
  TWILIO_PHARMACY_CLIENT_MEDIA_REQUEST_CONTENT_SID: "HX00000000000000000000000000000004",
  TWILIO_PHARMACY_OTP_CONTENT_SID: "HX00000000000000000000000000000005",
  TWILIO_PHARMACY_REQUEST_CONTENT_SID: "HX00000000000000000000000000000006",
};

function generated(suffix = "production") {
  return {
    configPath: "/private/generated",
    name: "generated-worker",
    main: "index.js",
    vars: {
      MED250_BACKEND_MODE: "worker-d1",
      NEXT_PUBLIC_SUPABASE_URL: "https://forbidden.supabase.co",
    },
    assets: { binding: "ASSETS", directory: "../client" },
    images: { binding: "IMAGES" },
    r2_buckets: [{ binding: "PRIVATE_MEDIA", bucket_name: `med250-private-media-${suffix}` }],
    queues: {
      producers: [{ binding: "DISPATCH_QUEUE", queue: `med250-whatsapp-dispatch-${suffix}` }],
      consumers: [
        { queue: `med250-whatsapp-dispatch-${suffix}` },
        { queue: `med250-whatsapp-dispatch-dlq-${suffix}` },
      ],
    },
  };
}

test("prepares a production config with only the governed D1 binding", () => {
  const config = prepareWorkerD1Config(generated(), {
    target: "production",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: databaseId,
    providerValues,
  });
  assert.equal(config.name, "med250-marketplace-gikundiro");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{ pattern: "med-250.com", custom_domain: true }]);
  assert.deepEqual(config.d1_databases, [{
    binding: "DB",
    database_name: "med250-production",
    database_id: databaseId,
    migrations_dir: "../../db/d1/migrations",
  }]);
  assert.deepEqual(Object.keys(config.d1_databases[0]).sort(), ["binding", "database_id", "database_name", "migrations_dir"]);
  assert.deepEqual(config.secrets.required, requiredWorkerSecretNames);
  assert.equal(config.vars.MED250_BACKEND_MODE, "worker-d1");
  assert.equal(config.vars.MED250_RELEASE_REVISION, revision);
  assert.equal(config.vars.NEXT_PUBLIC_MED250_INDEXING_MODE, "public");
  assert.equal(config.vars.MED250_WHATSAPP_PROVIDER, "twilio");
  assert.equal(config.vars.TWILIO_WHATSAPP_FROM, "whatsapp:+16622220600");
  assert.ok(config.secrets.required.includes("TWILIO_ACCOUNT_ID"));
  assert.equal(config.vars.WHATSAPP_ACCESS_TOKEN, undefined);
  assert.equal(config.vars.META_APP_ID, undefined);
  assert.equal(config.vars.NEXT_PUBLIC_SUPABASE_URL, undefined);
});

test("removes Vinext development dotenv material before production preparation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "med250-production-prep-"));
  try {
    const developmentVars = join(directory, ".dev.vars");
    await writeFile(developmentVars, "FORBIDDEN_LOCAL_VALUE=present\n");
    await removeDevelopmentOnlyVars(directory);
    await assert.rejects(access(developmentVars));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects every non-production deployment target", () => {
  assert.throws(() => prepareWorkerD1Config(generated(), {
    target: "staging",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: databaseId,
    providerValues,
  }), /has no staging deployment/);
});

test("rejects every attempt to switch the production provider away from Twilio", () => {
  assert.throws(() => prepareWorkerD1Config(generated(), {
    target: "production",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: databaseId,
    providerValues: { ...providerValues, MED250_WHATSAPP_PROVIDER: "meta" },
  }), /must remain Twilio/);
});

test("rejects stale provider SIDs that conflict with the built Worker configuration", () => {
  const built = generated();
  built.vars.TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID = "HX99999999999999999999999999999999";
  assert.throws(() => prepareWorkerD1Config(built, {
    target: "production",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: databaseId,
    providerValues,
  }), /refusing stale provider deployment/);
});

test("rejects local placeholder D1 IDs and cross-environment resources", () => {
  assert.throws(() => prepareWorkerD1Config(generated(), {
    target: "production",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: "00000000-0000-4000-8000-000000000003",
    providerValues,
  }), /not a local placeholder/);

  assert.throws(() => prepareWorkerD1Config(generated("staging"), {
    target: "production",
    origin: "https://med-250.com",
    releaseRevision: revision,
    d1DatabaseId: databaseId,
    providerValues,
  }), /PRIVATE_MEDIA/);
});

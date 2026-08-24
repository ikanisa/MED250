import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderPlan,
  executeProviderSetup,
  parseArguments,
} from "../scripts/twilio-whatsapp-setup.mjs";

const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const SENDER = "whatsapp:+16622220600";
const WABA_ID = "1188521970082273";
const API_KEY = `SK${"1".repeat(32)}`;
const API_SECRET = "provider-test-secret-never-print";
const SENDER_SID = `XE${"9".repeat(32)}`;

const credentials = {
  TWILIO_ACCOUNT_SID: ACCOUNT_SID,
  TWILIO_EXPECTED_ACCOUNT_SID: ACCOUNT_SID,
  TWILIO_WHATSAPP_FROM: SENDER,
  TWILIO_API_KEY: API_KEY,
  TWILIO_API_SECRET: API_SECRET,
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixture({
  approvalStatuses = ["approved", "approved", "approved", "approved", "approved"],
  driftIndex = -1,
  senderStatus = "ONLINE",
  senderPresent = true,
} = {}) {
  const plan = buildProviderPlan({ target: "production", env: credentials });
  const sids = plan.templates.map((_, index) => `HX${String(index + 1).repeat(32)}`);
  const posts = [];
  const requests = [];
  const fetchImpl = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    requests.push({ url: url.href, method });
    assert.match(new Headers(init.headers).get("authorization") || "", /^Basic /);

    if (url.hostname === "messaging.twilio.com" && url.pathname === "/v2/Channels/Senders") {
      return json({
        senders: senderPresent ? [{
          account_sid: ACCOUNT_SID,
          sid: SENDER_SID,
          sender_id: SENDER,
        }] : [],
        meta: { next_page_url: null },
      });
    }
    if (url.hostname === "messaging.twilio.com" && url.pathname === `/v2/Channels/Senders/${SENDER_SID}`) {
      return json({
        account_sid: ACCOUNT_SID,
        sid: SENDER_SID,
        sender_id: SENDER,
        status: senderStatus,
        configuration: { waba_id: WABA_ID },
      });
    }
    if (url.hostname === "content.twilio.com" && url.pathname === "/v1/Content" && method === "GET") {
      return json({
        contents: plan.templates.map((template, index) => ({
          account_sid: ACCOUNT_SID,
          sid: sids[index],
          friendly_name: template.content.friendly_name,
          language: template.content.language,
        })),
        meta: { next_page_url: null },
      });
    }
    const contentIndex = sids.findIndex((sid) => url.pathname === `/v1/Content/${sid}`);
    if (contentIndex >= 0 && method === "GET") {
      const content = structuredClone(plan.templates[contentIndex].content);
      if (contentIndex === driftIndex) content.variables["1"] = "DRIFTED";
      return json({ account_sid: ACCOUNT_SID, sid: sids[contentIndex], ...content });
    }
    const approvalIndex = sids.findIndex((sid) => url.pathname === `/v1/Content/${sid}/ApprovalRequests`);
    if (approvalIndex >= 0 && method === "GET") {
      const status = approvalStatuses[approvalIndex];
      return json(status === "unsubmitted" ? {
        account_sid: ACCOUNT_SID,
        sid: sids[approvalIndex],
      } : {
        account_sid: ACCOUNT_SID,
        sid: sids[approvalIndex],
        whatsapp: { status, rejection_reason: "" },
      });
    }
    const submitIndex = sids.findIndex((sid) => url.pathname === `/v1/Content/${sid}/ApprovalRequests/whatsapp`);
    if (submitIndex >= 0 && method === "POST") {
      posts.push({ url: url.href, body: JSON.parse(init.body) });
      return json({ status: "received", rejection_reason: "" });
    }
    throw new Error(`Unexpected mocked Twilio request: ${method} ${url.href}`);
  };
  return { plan, posts, requests, fetchImpl };
}

test("builds one deterministic Cloudflare production plan with separate provider operations", async () => {
  const first = buildProviderPlan({ target: "production", env: credentials });
  const second = buildProviderPlan({ target: "production", env: credentials });
  assert.equal(first.plan_sha256, second.plan_sha256);
  assert.match(first.plan_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.worker_origin, "https://med-250.com");
  assert.equal(first.templates.length, 5);
  assert.ok(first.templates.every((template) => (
    template.content.friendly_name.startsWith("med250_")
    && !template.content.friendly_name.startsWith("med250_staging_")
  )));
  assert.equal(
    first.templates[1].content.types["whatsapp/authentication"].actions[0].copy_code_text,
    "Copy Code",
  );
  assert.equal(
    first.templates[4].content.types["twilio/card"].media[0],
    "https://med-250.com/whatsapp-client-media/{{5}}.png",
  );
  assert.equal(parseArguments([]).mode, "plan");
  assert.equal(parseArguments(["--apply"]).mode, "apply");
  assert.equal(parseArguments(["--submit-approval"]).mode, "submit");
  assert.throws(
    () => parseArguments(["--apply", "--submit-approval"]),
    /exactly one provider mode/,
  );
  assert.throws(
    () => buildProviderPlan({
      target: "production",
      env: {
        ...credentials,
        TWILIO_WHATSAPP_WORKER_ORIGIN: "https://med250-marketplace-staging.ikanisa.workers.dev",
      },
    }),
    /production WhatsApp Worker origin/,
  );

  let output = "";
  await executeProviderSetup({
    argv: ["--mode=plan", "--target=production"],
    env: { ...credentials },
    stdout: (value) => { output += value; },
  });
  assert.doesNotMatch(output, new RegExp(API_SECRET));
  assert.doesNotMatch(output, new RegExp(API_KEY));
  assert.match(output, /MED250_TWILIO_APPLY_PRODUCTION/);
  assert.match(output, /MED250_TWILIO_SUBMIT_PRODUCTION/);
});

test("requires both the exact production confirmation and reviewed plan checksum before mutation", async () => {
  const { plan } = fixture();
  let fetched = false;
  await assert.rejects(
    executeProviderSetup({
      argv: [
        "--mode=apply",
        "--target=production",
        "--confirm=wrong",
        `--plan-sha256=${plan.plan_sha256}`,
      ],
      env: credentials,
      fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
      stdout: () => {},
    }),
    /MED250_TWILIO_APPLY_PRODUCTION/,
  );
  assert.equal(fetched, false);

  await assert.rejects(
    executeProviderSetup({
      argv: [
        "--mode=submit",
        "--target=production",
        "--confirm=MED250_TWILIO_SUBMIT_PRODUCTION",
        `--plan-sha256=${"0".repeat(64)}`,
      ],
      env: credentials,
      fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
      stdout: () => {},
    }),
    /requires --plan-sha256/,
  );
  assert.equal(fetched, false);
});

test("read-only verification proves sender, WABA, exact templates, approvals, and a non-secret Cloudflare manifest", async () => {
  const { fetchImpl } = fixture();
  let output = "";
  const result = await executeProviderSetup({
    argv: ["--mode=verify", "--target=production"],
    env: credentials,
    fetchImpl,
    stdout: (value) => { output += value; },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.ready, true);
  assert.equal(result.output.sender.online, true);
  assert.equal(result.output.sender.waba_match, true);
  assert.equal(Object.keys(result.output.cloudflare_env_manifest.content_sids).length, 7);
  assert.doesNotMatch(output, new RegExp(API_SECRET));
  assert.doesNotMatch(output, new RegExp(API_KEY));
  assert.doesNotMatch(output, /auth.?token/i);
});

test("submission is idempotent and posts only exact unsubmitted templates", async () => {
  const { plan, posts, fetchImpl } = fixture({
    approvalStatuses: ["approved", "pending", "received", "unsubmitted", "unsubmitted"],
  });
  const result = await executeProviderSetup({
    argv: [
      "--mode=submit",
      "--target=production",
      "--confirm=MED250_TWILIO_SUBMIT_PRODUCTION",
      `--plan-sha256=${plan.plan_sha256}`,
    ],
    env: credentials,
    fetchImpl,
    stdout: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((post) => post.body.name), [
    "med250_client_location_choice_v1",
    "med250_pharmacy_client_media_request_v1",
  ]);
  assert.equal(result.output.templates.filter((template) => template.submitted).length, 2);
});

test("template drift aborts before any approval submission", async () => {
  const { plan, posts, fetchImpl } = fixture({
    approvalStatuses: ["unsubmitted", "unsubmitted", "unsubmitted", "unsubmitted", "unsubmitted"],
    driftIndex: 2,
  });
  await assert.rejects(
    executeProviderSetup({
      argv: [
        "--mode=submit",
        "--target=production",
        "--confirm=MED250_TWILIO_SUBMIT_PRODUCTION",
        `--plan-sha256=${plan.plan_sha256}`,
      ],
      env: credentials,
      fetchImpl,
      stdout: () => {},
    }),
    /differs from the checksum-bound MED250 specification/,
  );
  assert.equal(posts.length, 0);
});

test("verification fails closed when the sender is absent", async () => {
  const { fetchImpl } = fixture({ senderPresent: false });
  const result = await executeProviderSetup({
    argv: ["--mode=verify", "--target=production"],
    env: credentials,
    fetchImpl,
    stdout: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.output.ready, false);
  assert.equal(result.output.sender.status, "missing");
});

test("Twilio API failures redact API credentials", async () => {
  const fetchImpl = async () => json({
    code: 20003,
    message: `bad ${API_SECRET} and ${API_KEY}`,
  }, 401);
  await assert.rejects(
    executeProviderSetup({
      argv: ["--mode=verify", "--target=production"],
      env: credentials,
      fetchImpl,
      stdout: () => {},
    }),
    (error) => {
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, new RegExp(API_SECRET));
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    },
  );
});

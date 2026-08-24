import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const EXPECTED_SENDER = "whatsapp:+16622220600";
const EXPECTED_WABA_ID = "1188521970082273";
const EXPECTED_META_PHONE_NUMBER_ID = "900256399838407";
const CONTENT_SID = /^HX[0-9a-f]{32}$/i;
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID = /^SK[0-9a-f]{32}$/i;
const MUTATING_MODES = new Set(["apply", "submit"]);
const APPROVAL_IN_FLIGHT = new Set(["received", "pending", "approved"]);
const APPROVAL_BLOCKED = new Set(["rejected", "paused", "disabled"]);
const ALLOWED_API_HOSTS = new Set(["content.twilio.com", "messaging.twilio.com"]);

const TARGETS = Object.freeze({
  production: Object.freeze({
    workerOrigin: "https://med-250.com",
    confirmations: Object.freeze({
      apply: "MED250_TWILIO_APPLY_PRODUCTION",
      submit: "MED250_TWILIO_SUBMIT_PRODUCTION",
    }),
  }),
});

const SAMPLE_ORDER_ID = "00000000-0000-4000-8000-000000000001";
const SAMPLE_PHARMACY_ID = "00000000-0000-4000-8000-000000000002";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function valueFor(argv, name) {
  const prefix = `${name}=`;
  const direct = argv.find((value) => value.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseArguments(argv) {
  const legacyModes = [
    argv.includes("--apply") && "apply",
    argv.includes("--submit-approval") && "submit",
    argv.includes("--verify") && "verify",
  ].filter(Boolean);
  const explicitMode = valueFor(argv, "--mode");
  if (legacyModes.length > 1 || (explicitMode && legacyModes.length)) {
    throw new Error("Choose exactly one provider mode: plan, apply, submit, or verify.");
  }
  const mode = explicitMode || legacyModes[0] || "plan";
  if (!["plan", "apply", "submit", "verify"].includes(mode)) {
    throw new Error("Provider mode must be plan, apply, submit, or verify.");
  }
  const target = valueFor(argv, "--target") || "production";
  if (!Object.hasOwn(TARGETS, target)) {
    throw new Error("MED250 has one provider target: production.");
  }
  const supported = new Set([
    "--apply",
    "--submit-approval",
    "--verify",
    "--mode",
    "--target",
    "--confirm",
    "--plan-sha256",
    "--manifest-output",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const name = argument.split("=", 1)[0];
    if (!supported.has(name)) throw new Error(`Unsupported provider option: ${name}`);
    if (!argument.includes("=") && ["--mode", "--target", "--confirm", "--plan-sha256", "--manifest-output"].includes(name)) {
      index += 1;
      if (!argv[index] || argv[index].startsWith("--")) throw new Error(`${name} requires a value.`);
    }
  }
  return {
    mode,
    target,
    confirm: valueFor(argv, "--confirm") || "",
    planSha256: valueFor(argv, "--plan-sha256") || "",
    manifestOutput: valueFor(argv, "--manifest-output") || "",
  };
}

function cleanOrigin(configured, target) {
  let url;
  try {
    url = new URL(configured || TARGETS[target].workerOrigin);
  } catch {
    throw new Error("The WhatsApp Worker origin must be a valid HTTPS origin.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.origin !== TARGETS[target].workerOrigin
  ) {
    throw new Error(`The ${target} WhatsApp Worker origin must equal ${TARGETS[target].workerOrigin}.`);
  }
  return url.origin;
}

function workerUrl(configured, fallback, origin, requiredVariable = "") {
  const raw = configured?.trim() || fallback;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Every WhatsApp template URL must be a valid Worker HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
    throw new Error("Every WhatsApp template URL must remain on the selected Cloudflare Worker origin.");
  }
  if (requiredVariable && !raw.includes(requiredVariable)) {
    throw new Error(`The WhatsApp template URL must contain ${requiredVariable}.`);
  }
  return raw;
}

export function buildProviderPlan({ target = "production", env = process.env } = {}) {
  if (!Object.hasOwn(TARGETS, target)) throw new Error("MED250 has one provider target: production.");
  const expectedAccountSid = required(env, "TWILIO_EXPECTED_ACCOUNT_SID", ACCOUNT_SID);
  const origin = cleanOrigin(
    env.TWILIO_WHATSAPP_WORKER_ORIGIN?.trim(),
    target,
  );
  const clientMediaUrl = workerUrl(
    env.TWILIO_WHATSAPP_CLIENT_MEDIA_TEMPLATE_URL,
    `${origin}/whatsapp-client-media/{{5}}.png`,
    origin,
    "{{5}}",
  );
  const orderMediaUrl = workerUrl(
    env.TWILIO_WHATSAPP_ORDER_MEDIA_TEMPLATE_URL,
    `${origin}/whatsapp-order-media/{{7}}.png`,
    origin,
    "{{7}}",
  );
  const locationBaseUrl = workerUrl(
    env.TWILIO_WHATSAPP_LOCATION_URL,
    `${origin}/whatsapp/location`,
    origin,
  );
  const templates = [
    {
      envNames: ["TWILIO_PHARMACY_REQUEST_CONTENT_SID"],
      approvalCategory: "UTILITY",
      content: {
        friendly_name: "med250_pharmacy_request_v3",
        language: "en",
        variables: {
          "1": "MED250-TEST-001",
          "2": "2x Amoxicillin 500 mg; 1x Paracetamol 500 mg",
          "3": "3",
          "4": "+250788000000",
          "5": "Approx. 1.2 km away",
          "6": "pickup or delivery",
          "7": "sample",
          "8": `med250:can:${SAMPLE_ORDER_ID}:${SAMPLE_PHARMACY_ID}`,
          "9": `med250:cannot:${SAMPLE_ORDER_ID}:${SAMPLE_PHARMACY_ID}`,
        },
        types: {
          "twilio/card": {
            title: "New MED+250 request {{1}}. Medicines: {{2}}. Total units: {{3}}. Customer WhatsApp: {{4}}. Routing: {{5}}. Fulfilment: {{6}}. Confirm below; this request is also available in the pharmacy web portal.",
            media: [orderMediaUrl],
            actions: [
              { type: "QUICK_REPLY", title: "Can fulfil", id: "{{8}}" },
              { type: "QUICK_REPLY", title: "Cannot fulfil", id: "{{9}}" },
            ],
          },
        },
      },
    },
    {
      envNames: ["TWILIO_PHARMACY_OTP_CONTENT_SID", "TWILIO_CUSTOMER_OTP_CONTENT_SID", "TWILIO_OTP_CONTENT_SID"],
      approvalCategory: "AUTHENTICATION",
      content: {
        friendly_name: "med250_whatsapp_otp_v1",
        language: "en",
        variables: { "1": "123456" },
        types: {
          "whatsapp/authentication": {
            add_security_recommendation: true,
            code_expiration_minutes: 5,
            actions: [{ type: "COPY_CODE", copy_code_text: "Copy Code" }],
          },
        },
      },
    },
    {
      envNames: ["TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID"],
      approvalCategory: "UTILITY",
      content: {
        friendly_name: "med250_client_location_capture_v2",
        language: "en",
        variables: { "1": "sample" },
        types: {
          "twilio/call-to-action": {
            body: "We received your medicine or prescription image. Tap Share location to open the secure MED+250 map inside WhatsApp. By continuing, you allow MED+250 to save this location and share your image and WhatsApp number with up to 10 assigned verified nearby pharmacies.",
            actions: [{ type: "URL", title: "Share location", url: `${locationBaseUrl}?token={{1}}` }],
          },
        },
      },
    },
    {
      envNames: ["TWILIO_CLIENT_LOCATION_CHOICE_CONTENT_SID"],
      approvalCategory: "UTILITY",
      content: {
        friendly_name: "med250_client_location_choice_v1",
        language: "en",
        variables: {
          "1": `med250:loc:saved:${SAMPLE_ORDER_ID}:${SAMPLE_PHARMACY_ID}`,
          "2": `med250:loc:new:${SAMPLE_ORDER_ID}`,
        },
        types: {
          "twilio/quick-reply": {
            body: "We have a saved delivery location for you. Choose it or share a new one. By continuing, you allow MED+250 to share your image and WhatsApp number with up to 10 assigned verified nearby pharmacies.",
            actions: [
              { type: "QUICK_REPLY", title: "Use saved location", id: "{{1}}" },
              { type: "QUICK_REPLY", title: "Share new location", id: "{{2}}" },
            ],
          },
        },
      },
    },
    {
      envNames: ["TWILIO_PHARMACY_CLIENT_MEDIA_REQUEST_CONTENT_SID"],
      approvalCategory: "UTILITY",
      content: {
        friendly_name: "med250_pharmacy_client_media_request_v1",
        language: "en",
        variables: {
          "1": "WA-TEST-001",
          "2": "1 of 2",
          "3": "+250788000000",
          "4": "Approx. 1.2 km away",
          "5": "sample",
          "6": `med250:media:can:${SAMPLE_ORDER_ID}:${SAMPLE_PHARMACY_ID}`,
          "7": `med250:media:cannot:${SAMPLE_ORDER_ID}:${SAMPLE_PHARMACY_ID}`,
        },
        types: {
          "twilio/card": {
            title: "New MED+250 image request {{1}}. Image {{2}}. Customer WhatsApp: {{3}}. Routing: {{4}}. This is only the client-supplied medicine or prescription image; no catalogue list was generated. Reply directly to the customer or confirm below.",
            media: [clientMediaUrl],
            actions: [
              { type: "QUICK_REPLY", title: "Can fulfil", id: "{{6}}" },
              { type: "QUICK_REPLY", title: "Cannot fulfil", id: "{{7}}" },
            ],
          },
        },
      },
    },
  ];
  const specification = {
    schema_version: 1,
    target,
    account_sid: expectedAccountSid,
    sender: EXPECTED_SENDER,
    waba_id: EXPECTED_WABA_ID,
    meta_phone_number_id: EXPECTED_META_PHONE_NUMBER_ID,
    worker_origin: origin,
    templates,
  };
  return { ...specification, plan_sha256: sha256(specification) };
}

function required(env, name, pattern) {
  const value = env[name]?.trim() ?? "";
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`Missing or invalid server configuration: ${name}`);
  }
  return value;
}

function credentials(env) {
  const accountSid = required(env, "TWILIO_ACCOUNT_SID", ACCOUNT_SID);
  const expectedAccountSid = required(env, "TWILIO_EXPECTED_ACCOUNT_SID", ACCOUNT_SID);
  if (accountSid !== expectedAccountSid) throw new Error("TWILIO_ACCOUNT_SID does not match the approved MED250 Twilio account.");
  const sender = required(env, "TWILIO_WHATSAPP_FROM", /^whatsapp:\+[1-9][0-9]{7,14}$/);
  if (sender !== EXPECTED_SENDER) throw new Error("TWILIO_WHATSAPP_FROM does not match the approved MED250 WhatsApp sender.");
  const key = required(env, "TWILIO_API_KEY", API_KEY_SID);
  const secret = required(env, "TWILIO_API_SECRET");
  return {
    accountSid,
    sender,
    authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
  };
}

function redact(value, env) {
  let output = String(value);
  for (const name of ["TWILIO_API_SECRET", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY"]) {
    const sensitive = env[name]?.trim();
    if (sensitive && sensitive.length >= 6) output = output.split(sensitive).join("[REDACTED]");
  }
  return output.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [REDACTED]");
}

function apiUrl(raw, base) {
  const url = new URL(raw, base);
  if (url.protocol !== "https:" || url.username || url.password || !ALLOWED_API_HOSTS.has(url.hostname)) {
    throw new Error("Twilio pagination attempted to leave an approved API origin.");
  }
  return url.href;
}

function createClient({ env, fetchImpl }) {
  const auth = credentials(env);
  async function request(rawUrl, options = {}) {
    const url = apiUrl(rawUrl);
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: auth.authorization,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Twilio returned a non-JSON response (${response.status}).`);
      }
    }
    if (options.allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const code = body.code ? ` ${body.code}` : "";
      throw new Error(redact(`Twilio request failed${code}: ${body.message ?? response.status}`, env));
    }
    return body;
  }
  return { ...auth, request };
}

function assertAccount(resource, accountSid, label) {
  const observed = resource?.account_sid ?? resource?.accountSid;
  if (observed && observed !== accountSid) throw new Error(`${label} belongs to a different Twilio account.`);
}

async function listPages(client, initialUrl, key) {
  const values = [];
  let next = apiUrl(initialUrl);
  let pages = 0;
  while (next) {
    if (pages >= 100) throw new Error(`Twilio ${key} pagination exceeded the safety limit.`);
    const body = await client.request(next);
    const page = body[key];
    if (!Array.isArray(page)) throw new Error(`Twilio ${key} response is malformed.`);
    for (const value of page) assertAccount(value, client.accountSid, `Twilio ${key} resource`);
    values.push(...page);
    next = body.meta?.next_page_url ? apiUrl(body.meta.next_page_url, next) : "";
    pages += 1;
  }
  return values;
}

function senderId(sender) {
  return sender.sender_id ?? sender.senderId ?? "";
}

function senderWabaId(sender) {
  return sender.configuration?.waba_id ?? sender.configuration?.wabaId ?? "";
}

async function fetchSender(client) {
  const senders = await listPages(
    client,
    "https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=1000",
    "senders",
  );
  const matches = senders.filter((sender) => senderId(sender) === client.sender);
  if (matches.length > 1) throw new Error("The approved MED250 WhatsApp sender is duplicated in the Twilio account.");
  if (!matches.length) return { found: false, online: false, waba_match: false, sid: null, status: "missing" };
  const sid = matches[0].sid;
  if (!/^XE[0-9a-f]{32}$/i.test(sid ?? "")) throw new Error("Twilio returned an invalid WhatsApp Sender SID.");
  const sender = await client.request(`https://messaging.twilio.com/v2/Channels/Senders/${sid}`);
  assertAccount(sender, client.accountSid, "Twilio WhatsApp sender");
  if (senderId(sender) !== client.sender) throw new Error("Twilio returned the wrong WhatsApp sender.");
  const status = String(sender.status ?? "unknown").toLowerCase();
  const wabaId = senderWabaId(sender);
  return {
    found: true,
    online: status === "online",
    waba_match: wabaId === EXPECTED_WABA_ID,
    sid,
    status,
  };
}

function contentShape(value) {
  return {
    friendly_name: value.friendly_name,
    language: value.language,
    variables: value.variables ?? {},
    types: value.types ?? {},
  };
}

function assertExactContent(actual, template) {
  if (stableJson(contentShape(actual)) !== stableJson(template.content)) {
    throw new Error(`Existing Twilio content ${template.content.friendly_name} differs from the checksum-bound MED250 specification.`);
  }
}

function findContent(contents, template) {
  const matches = contents.filter((entry) => (
    entry.friendly_name === template.content.friendly_name
    && entry.language === template.content.language
  ));
  if (matches.length > 1) throw new Error(`Twilio has duplicate content named ${template.content.friendly_name}.`);
  return matches[0] ?? null;
}

async function fetchExactContent(client, summary, template) {
  if (!CONTENT_SID.test(summary.sid ?? "")) throw new Error("Twilio returned an invalid Content SID.");
  const content = await client.request(`https://content.twilio.com/v1/Content/${summary.sid}`);
  assertAccount(content, client.accountSid, "Twilio content");
  assertExactContent(content, template);
  return content;
}

async function fetchApproval(client, sid) {
  const body = await client.request(
    `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`,
    { allowNotFound: true },
  );
  if (!body?.whatsapp) return { status: "unsubmitted", rejection_reason: "" };
  assertAccount(body, client.accountSid, "Twilio approval");
  return {
    status: String(body.whatsapp.status ?? "unknown").toLowerCase(),
    rejection_reason: String(body.whatsapp.rejection_reason ?? ""),
  };
}

async function inventory(client, plan) {
  const sender = await fetchSender(client);
  const contents = await listPages(client, "https://content.twilio.com/v1/Content?PageSize=500", "contents");
  const templates = [];
  for (const template of plan.templates) {
    const summary = findContent(contents, template);
    if (!summary) {
      templates.push({ template, found: false, sid: null, exact: false, approval: { status: "unsubmitted", rejection_reason: "" } });
      continue;
    }
    const content = await fetchExactContent(client, summary, template);
    const approval = await fetchApproval(client, content.sid);
    templates.push({ template, found: true, sid: content.sid, exact: true, approval });
  }
  return { sender, templates };
}

function assertSenderReady(sender) {
  if (!sender.found) throw new Error("The approved MED250 WhatsApp sender is not registered in this Twilio account.");
  if (!sender.online) throw new Error(`The approved MED250 WhatsApp sender is not ONLINE (status: ${sender.status}).`);
  if (!sender.waba_match) throw new Error("The Twilio WhatsApp sender does not match the approved MED250 WABA.");
}

async function createContent(client, template) {
  const created = await client.request("https://content.twilio.com/v1/Content", {
    method: "POST",
    body: JSON.stringify(template.content),
  });
  assertAccount(created, client.accountSid, "Created Twilio content");
  if (!CONTENT_SID.test(created.sid ?? "")) throw new Error(`Twilio did not return a Content SID for ${template.content.friendly_name}.`);
  return fetchExactContent(client, created, template);
}

async function submitApproval(client, sid, template) {
  const result = await client.request(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`, {
    method: "POST",
    body: JSON.stringify({
      name: template.content.friendly_name,
      category: template.approvalCategory,
    }),
  });
  const status = String(result.status ?? "unknown").toLowerCase();
  if (!APPROVAL_IN_FLIGHT.has(status)) throw new Error(`Twilio returned an unexpected approval status for ${template.content.friendly_name}.`);
  return status;
}

function publicTemplateResult(item) {
  return {
    friendly_name: item.template.content.friendly_name,
    sid: item.sid,
    found: item.found,
    exact: item.exact,
    approval_status: item.approval.status,
    ...(item.approval.rejection_reason ? { rejection_reason: item.approval.rejection_reason } : {}),
  };
}

function manifest(plan, items) {
  const contentSids = {};
  for (const item of items) {
    if (!CONTENT_SID.test(item.sid ?? "")) throw new Error("Cannot generate a Cloudflare manifest before every Content SID is known.");
    for (const name of item.template.envNames) contentSids[name] = item.sid;
  }
  return {
    schema_version: 1,
    target: plan.target,
    plan_sha256: plan.plan_sha256,
    worker_origin: plan.worker_origin,
    account_sid: plan.account_sid,
    sender: plan.sender,
    content_sids: stableValue(contentSids),
  };
}

function assertMutationAuthority(options, plan) {
  const expected = TARGETS[options.target].confirmations[options.mode];
  if (options.confirm !== expected) throw new Error(`Mode ${options.mode} requires --confirm=${expected}.`);
  if (!/^[0-9a-f]{64}$/i.test(options.planSha256) || options.planSha256 !== plan.plan_sha256) {
    throw new Error(`Mode ${options.mode} requires --plan-sha256=${plan.plan_sha256}.`);
  }
}

function planOutput(plan) {
  return {
    mode: "plan",
    target: plan.target,
    plan_sha256: plan.plan_sha256,
    account_sid: plan.account_sid,
    sender: plan.sender,
    waba_id: plan.waba_id,
    meta_phone_number_id: plan.meta_phone_number_id,
    worker_origin: plan.worker_origin,
    template_count: plan.templates.length,
    templates: plan.templates.map((template) => ({
      friendly_name: template.content.friendly_name,
      language: template.content.language,
      category: template.approvalCategory,
      env_names: template.envNames,
      types: Object.keys(template.content.types),
      content_sha256: sha256(template.content),
    })),
    next: {
      apply: `--mode=apply --target=${plan.target} --confirm=${TARGETS[plan.target].confirmations.apply} --plan-sha256=${plan.plan_sha256}`,
      submit: `--mode=submit --target=${plan.target} --confirm=${TARGETS[plan.target].confirmations.submit} --plan-sha256=${plan.plan_sha256}`,
      verify: `--mode=verify --target=${plan.target}`,
    },
  };
}

export async function executeProviderSetup({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = (value) => process.stdout.write(value),
  manifestWriter = writeFile,
} = {}) {
  const options = parseArguments(argv);
  const plan = buildProviderPlan({ target: options.target, env });
  if (options.mode === "plan") {
    stdout(`${JSON.stringify(planOutput(plan), null, 2)}\n`);
    return { exitCode: 0, mode: "plan", plan };
  }
  if (MUTATING_MODES.has(options.mode)) assertMutationAuthority(options, plan);
  const client = createClient({ env, fetchImpl });
  const current = await inventory(client, plan);

  if (options.mode === "verify") {
    const ready = current.sender.found
      && current.sender.online
      && current.sender.waba_match
      && current.templates.every((item) => item.found && item.exact && item.approval.status === "approved");
    const output = {
      mode: "verify",
      target: plan.target,
      ready,
      plan_sha256: plan.plan_sha256,
      sender: current.sender,
      templates: current.templates.map(publicTemplateResult),
    };
    if (current.templates.every((item) => item.sid)) output.cloudflare_env_manifest = manifest(plan, current.templates);
    if (options.manifestOutput && output.cloudflare_env_manifest) {
      await manifestWriter(options.manifestOutput, `${JSON.stringify(output.cloudflare_env_manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    stdout(`${JSON.stringify(output, null, 2)}\n`);
    return { exitCode: ready ? 0 : 1, mode: "verify", plan, output };
  }

  assertSenderReady(current.sender);
  if (options.mode === "apply") {
    const results = [];
    for (const item of current.templates) {
      if (item.found) {
        results.push({ ...item, created: false });
        continue;
      }
      const content = await createContent(client, item.template);
      results.push({
        ...item,
        found: true,
        exact: true,
        sid: content.sid,
        created: true,
        approval: { status: "unsubmitted", rejection_reason: "" },
      });
    }
    const cloudflareManifest = manifest(plan, results);
    if (options.manifestOutput) {
      await manifestWriter(options.manifestOutput, `${JSON.stringify(cloudflareManifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
    const output = {
      mode: "apply",
      target: plan.target,
      plan_sha256: plan.plan_sha256,
      sender: current.sender,
      templates: results.map((item) => ({ ...publicTemplateResult(item), created: item.created })),
      cloudflare_env_manifest: cloudflareManifest,
      next: "Review the exact applied templates, then run the separately confirmed submit mode.",
    };
    stdout(`${JSON.stringify(output, null, 2)}\n`);
    return { exitCode: 0, mode: "apply", plan, output };
  }

  for (const item of current.templates) {
    if (!item.found) throw new Error(`Cannot submit missing Twilio content ${item.template.content.friendly_name}; run apply first.`);
    if (APPROVAL_BLOCKED.has(item.approval.status)) {
      throw new Error(`Cannot resubmit ${item.template.content.friendly_name} while its approval status is ${item.approval.status}; review and version the template first.`);
    }
    if (!APPROVAL_IN_FLIGHT.has(item.approval.status) && item.approval.status !== "unsubmitted") {
      throw new Error(`Cannot submit ${item.template.content.friendly_name} with unknown approval status ${item.approval.status}.`);
    }
  }
  const results = [];
  for (const item of current.templates) {
    if (APPROVAL_IN_FLIGHT.has(item.approval.status)) {
      results.push({ ...item, submitted: false });
      continue;
    }
    const status = await submitApproval(client, item.sid, item.template);
    results.push({ ...item, submitted: true, approval: { status, rejection_reason: "" } });
  }
  const cloudflareManifest = manifest(plan, results);
  if (options.manifestOutput) {
    await manifestWriter(options.manifestOutput, `${JSON.stringify(cloudflareManifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  const output = {
    mode: "submit",
    target: plan.target,
    plan_sha256: plan.plan_sha256,
    sender: current.sender,
    templates: results.map((item) => ({ ...publicTemplateResult(item), submitted: item.submitted })),
    cloudflare_env_manifest: cloudflareManifest,
    next: "Run verify after Meta has reviewed every template; only approved status satisfies readiness.",
  };
  stdout(`${JSON.stringify(output, null, 2)}\n`);
  return { exitCode: 0, mode: "submit", plan, output };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const result = await executeProviderSetup();
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : error, process.env)}\n`);
    process.exitCode = 1;
  }
}

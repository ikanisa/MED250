import assert from "node:assert/strict";
import test from "node:test";

import {
  assessLegacyDomainRedirect,
  canonicalOrigin,
  legacyOrigin,
  legacyRedirectProbes,
  parseArguments,
  validateLegacyDomainRedirectEvidence,
} from "../scripts/verify-legacy-domain-redirect.mjs";

function passingRecords() {
  return legacyRedirectProbes.map((path) => ({
    path,
    status: 308,
    location: new URL(path, `${canonicalOrigin}/`).toString(),
    set_cookie_present: false,
    error_code: null,
  }));
}

test("accepts only complete path-and-query-preserving redirects to the canonical origin", () => {
  const result = assessLegacyDomainRedirect(passingRecords());
  assert.equal(result.status, "passed");
  assert.equal(result.productionReady, false);
  assert.equal(result.legacyOrigin, legacyOrigin);
  assert.equal(result.canonicalOrigin, canonicalOrigin);
  assert.equal(result.passedProbeCount, legacyRedirectProbes.length);
  assert.deepEqual(result.errors, []);
});

test("rejects unresolved DNS, served content, cookies, and redirect drift", () => {
  const records = passingRecords();
  records[0].error_code = "dns_unresolved";
  records[1].status = 200;
  records[2].location = `${canonicalOrigin}/wrong-product`;
  records[3].set_cookie_present = true;
  const result = assessLegacyDomainRedirect(records);
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /dns_unresolved/);
  assert.match(result.errors.join("\n"), /expected HTTP 301 or 308/);
  assert.match(result.errors.join("\n"), /preserve the exact path and query/);
  assert.match(result.errors.join("\n"), /must not set cookies/);
});

test("rejects missing, duplicate, or reordered redirect probes", () => {
  const missing = passingRecords().slice(1);
  assert.match(
    assessLegacyDomainRedirect(missing).errors.join("\n"),
    /complete, unique, and in canonical order/,
  );

  const reordered = passingRecords().reverse();
  assert.match(
    assessLegacyDomainRedirect(reordered).errors.join("\n"),
    /complete, unique, and in canonical order/,
  );
});

test("accepts only an optional evidence output path", () => {
  assert.deepEqual(parseArguments([]), { evidenceOutput: "" });
  assert.deepEqual(parseArguments(["--evidence-output", "receipt.json"]), {
    evidenceOutput: "receipt.json",
  });
  assert.throws(() => parseArguments(["--evidence-output"]), /requires a path/);
  assert.throws(() => parseArguments(["--origin", "https://example.com"]), /Unknown argument/);
});

test("accepts only fresh evidence from the current verifier contract", () => {
  const verifierSha256 = "a".repeat(64);
  const evidence = {
    schema_version: "1",
    captured_at: "2026-07-24T10:00:00.000Z",
    verifier_sha256: verifierSha256,
    classification: "redirect_only_external_probe_not_launch_approval",
    status: "passed",
    productionReady: false,
    legacyOrigin,
    canonicalOrigin,
    records: passingRecords(),
  };
  const valid = validateLegacyDomainRedirectEvidence(evidence, {
    expectedVerifierSha256: verifierSha256,
    now: new Date("2026-07-24T10:30:00.000Z"),
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, []);

  const stale = validateLegacyDomainRedirectEvidence(evidence, {
    expectedVerifierSha256: "b".repeat(64),
    now: new Date("2026-07-26T10:30:00.000Z"),
  });
  assert.equal(stale.valid, false);
  assert.match(stale.errors.join("\n"), /different verifier revision/);
  assert.match(stale.errors.join("\n"), /stale/);
});

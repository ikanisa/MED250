import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  canonicalProductionOrigin,
  expectedAuditBrowserScenarios,
  validateAuditBrowserEvidence,
} from "../scripts/validate-audit-browser-evidence.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const pendingLedger = JSON.parse(readFileSync(join(repositoryRoot, "data/audit-browser-evidence.json"), "utf8"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function routeFor(expectedCapture) {
  return [
    "/product/AMZ-ABCDEFGHIJ",
    "/category/medicines",
    "/category/personal-care",
    "/category/baby-family",
    "/category/wellness",
    "/categories?q=paracetamol",
    "/",
  ].find((candidate) => expectedCapture.routePattern.test(candidate));
}

function writeJson(root, path, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return { path, sha256: digest(bytes) };
}

function createPassingFixture() {
  const root = mkdtempSync(join(tmpdir(), "med250-audit-browser-"));
  const ledger = structuredClone(pendingLedger);
  const release = "0123456789abcdef0123456789abcdef01234567";
  Object.assign(ledger, {
    status: "passed",
    origin: canonicalProductionOrigin,
    release_revision: release,
    capture_tool: "in-app-browser",
    executed_by: "QA Executor",
    started_at: "2026-07-18T10:00:00+02:00",
    completed_at: "2026-07-18T10:20:00+02:00",
    redaction_confirmed: true,
    personal_data_recorded: false,
    credentials_recorded: false,
    approved_by: "QA Approver",
    approved_role: "Quality assurance owner",
    approved_at: "2026-07-18T10:30:00+02:00",
  });

  for (const [scenarioId, expected] of Object.entries(expectedAuditBrowserScenarios)) {
    const scenario = ledger.scenarios[scenarioId];
    scenario.status = "passed";
    scenario.note = "All governed scenario conditions passed without retaining private data.";
    for (const [captureId, expectedCapture] of Object.entries(expected.captures)) {
      const path = `docs/audit/browser-evidence/${scenarioId.toLowerCase()}-${captureId}.png`;
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, png);
      Object.assign(scenario.captures[captureId], {
        status: "passed",
        note: "Acceptance condition confirmed without retaining private data.",
        route: routeFor(expectedCapture),
        viewport_width: expected.device === "desktop" ? 1_440 : 390,
        viewport_height: expected.device === "desktop" ? 900 : 844,
        captured_at: "2026-07-18T10:10:00+02:00",
        screenshot_path: path,
        screenshot_sha256: digest(png),
      });
    }
  }

  ledger.deployment_receipt = writeJson(root, "docs/audit/deployment-verification.json", {
    schemaVersion: "1.0",
    capturedAt: "2026-07-18T10:00:00+02:00",
    status: "passed",
    errors: [],
    mode: "live",
    origin: ledger.origin,
    observedReleaseRevision: release,
    expectedReleaseRevision: release,
    releaseRevisionExpectation: "matched",
  });
  ledger.catalogue_receipt = writeJson(root, "docs/audit/catalogue-verification.json", {
    schemaVersion: "1.0",
    capturedAt: "2026-07-18T10:00:00+02:00",
    status: "passed",
    errors: [],
    expectedTotal: 4_657,
    observedTotal: 4_657,
    boundaryProducts: {
      product25: "AMZ-ABCDEFGHIJ",
      product120: "AMZ-BCDEFGHIJK",
      finalProduct: "AMZ-CDEFGHIJKL",
    },
    searches: ["paracetamol", "zinc", "omeprazole", "typo", "french", "kinyarwanda"]
      .map((id) => ({ id, total: 1 })),
  });

  return { ledger, root };
}

test("completed audit browser execution is valid but cannot pass strict closure without approval", () => {
  const planned = validateAuditBrowserEvidence(pendingLedger, { rootDir: repositoryRoot });
  assert.equal(planned.valid, true, planned.errors.join("\n"));
  assert.equal(planned.scenarioCount, 16);
  assert.equal(planned.captureCount, 56);
  assert.deepEqual(planned.statusCounts, { pending: 0, passed: 16, failed: 0, blocked: 0, invalid: 0 });
  assert.equal(pendingLedger.execution_status, "completed_awaiting_approval");
  assert.match(planned.warnings.join("\n"), /historical origin/);

  const strict = validateAuditBrowserEvidence(pendingLedger, {
    strict: true,
    rootDir: repositoryRoot,
    currentReleaseRevision: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.equal(strict.valid, false);
  assert.match(strict.errors.join("\n"), /current production origin/);
  assert.match(strict.errors.join("\n"), /release revision is stale/);
  assert.match(strict.errors.join("\n"), /requires a named approver/);
  assert.match(strict.errors.join("\n"), /overall status must be passed/);
});

test("strict closure accepts a complete source- and release-bound evidence fixture", () => {
  const fixture = createPassingFixture();
  try {
    const result = validateAuditBrowserEvidence(fixture.ledger, {
      strict: true,
      rootDir: fixture.root,
      now: new Date("2026-07-18T11:00:00+02:00"),
      currentReleaseRevision: fixture.ledger.release_revision,
    });
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.scenarioCount, 16);
    assert.equal(result.captureCount, 56);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("strict closure fails on screenshot, release, viewport, and plan tampering", () => {
  const fixture = createPassingFixture();
  try {
    const ledger = fixture.ledger;
    ledger.release_revision = "fedcba9876543210fedcba9876543210fedcba98";
    ledger.scenarios.MOBILE_DEPARTMENTS.captures.medicines.viewport_width = 900;
    ledger.scenarios.DESKTOP_DEPARTMENTS.captures.medicines.screenshot_sha256 = "0".repeat(64);
    delete ledger.scenarios.DESKTOP_SEARCH_MATRIX.captures.zinc;
    const result = validateAuditBrowserEvidence(ledger, {
      strict: true,
      rootDir: fixture.root,
      now: new Date("2026-07-18T11:00:00+02:00"),
      currentReleaseRevision: "0123456789abcdef0123456789abcdef01234567",
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /deployment receipt is not exactly bound/);
    assert.match(result.errors.join("\n"), /needs a mobile viewport/);
    assert.match(result.errors.join("\n"), /screenshot SHA-256 does not match/);
    assert.match(result.errors.join("\n"), /missing capture zinc/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("evidence notes reject personal data and secret material", () => {
  const fixture = createPassingFixture();
  try {
    fixture.ledger.scenarios.DESKTOP_PRODUCT_CONTENT.note = "Customer phone number: 0781234567 and access_token=unsafe";
    const result = validateAuditBrowserEvidence(fixture.ledger, {
      strict: true,
      rootDir: fixture.root,
      now: new Date("2026-07-18T11:00:00+02:00"),
      currentReleaseRevision: fixture.ledger.release_revision,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /prohibited identity or secret material/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

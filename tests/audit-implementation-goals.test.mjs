import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { validateAuditImplementationRegister } from "../scripts/validate-audit-implementation-register.mjs";

const register = JSON.parse(await readFile(new URL("../data/audit-implementation-register.json", import.meta.url), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function createCompleteFindingFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "med250-audit-closure-"));
  const fixture = structuredClone(register);
  const finding = fixture.findings.find(({ id }) => id === "P0-1");
  const recordedAt = "2026-07-18T10:00:00+02:00";
  const reference = "docs/audit/closure-evidence/p0-1-browser-evidence.json";
  const artifact = {
    schema_version: "1",
    audit_source_revision: fixture.audit.source_revision,
    item_id: finding.id,
    status: "passed",
    evidence_type: "browser_test",
    recorded_at: recordedAt,
    summary: "Every advertised department passed the governed desktop and mobile evidence plan.",
    errors: [],
    contains_personal_data: false,
    contains_secrets: false,
  };
  const bytes = Buffer.from(JSON.stringify(artifact, null, 2));
  await mkdir(dirname(join(rootDir, reference)), { recursive: true });
  await writeFile(join(rootDir, reference), bytes);
  finding.status = "complete";
  finding.remaining = [];
  finding.closure = {
    audit_source_revision: fixture.audit.source_revision,
    approved_by: "QA Owner",
    approved_role: "Quality assurance owner",
    approved_at: "2026-07-18T10:30:00+02:00",
    evidence: [{
      reference,
      sha256: digest(bytes),
      recorded_at: recordedAt,
      summary: "The controlled production evidence covers every acceptance condition.",
      covers: [0, 1],
    }],
  };
  return { fixture, finding, rootDir, reference };
}

test("maps every audit finding and strategic item to governed goals", async () => {
  const result = await validateAuditImplementationRegister(register);
  assert.deepEqual(result.errors, []);
  assert.equal(result.findingCount, 17);
  assert.equal(result.strategicItemCount, 3);
  assert.deepEqual(result.sourceCoverageCounts, {
    findingCount: 17,
    scorecardCategoryCount: 9,
    preservationInvariantCount: 5,
    benchmarkCapabilityCount: 11,
    roadmapActionCount: 15,
    verificationLimitCount: 4,
    auditedSurfaceCount: 12,
  });
  assert.equal(result.sourceUnitCount, 73);
  assert.equal(Object.values(result.statusCounts).reduce((total, count) => total + count, 0), 17);
});

test("rejects missing source strengths, benchmark rows, and roadmap mappings", async () => {
  const fixture = structuredClone(register);
  fixture.source_coverage.preservation_invariants.pop();
  fixture.source_coverage.benchmark_capabilities[0].items = [];
  fixture.source_coverage.roadmap_actions.find(({ id }) => id === "R3-2").items = ["P2-3"];
  const result = await validateAuditImplementationRegister(fixture, { verifyEvidence: false });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /working-well directive/);
  assert.match(result.errors.join("\n"), /B-1: at least one governed audit-item mapping is required/);
  assert.match(result.errors.join("\n"), /R3-2: the owner-declined recommendation must map only to P2-2/);
});

test("records the product-owner override without leaving retired UI behind", async () => {
  const finding = register.findings.find(({ id }) => id === "P2-2");
  assert.equal(finding.status, "owner_declined");
  assert.equal(finding.remaining.length, 0);
  assert.match(finding.decision.rationale, /removed completely and not reintroduced/i);

  const retiredWords = ["how", "it", "works"];
  const retiredPhrase = retiredWords.join(" ");
  const retiredSlug = retiredWords.join("-");
  const retiredSelectors = [".how" + "-section", ".how" + "-copy"];
  const sources = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(sources.every((source) => !source.toLowerCase().includes(retiredPhrase)));
  assert.ok(sources.every((source) => !source.toLowerCase().includes(retiredSlug)));
  assert.ok(sources.every((source) => retiredSelectors.every((selector) => !source.includes(selector))));
  await assert.rejects(access(new URL(`../app/${retiredSlug}/page.tsx`, import.meta.url)));
});

test("keeps every incomplete audit item honest about remaining closure", () => {
  for (const finding of register.findings) {
    if (finding.status === "owner_declined") continue;
    assert.ok(finding.remaining.length > 0, `${finding.id} must name remaining closure`);
    assert.notEqual(finding.status, "complete");
  }
});

test("accepts a complete finding only with source-bound, hashed, fully covering evidence", async () => {
  const { fixture, rootDir } = await createCompleteFindingFixture();
  try {
    const result = await validateAuditImplementationRegister(fixture, {
      verifyEvidence: false,
      rootDir,
      now: new Date("2026-07-18T11:00:00+02:00"),
    });
    assert.equal(result.valid, true, result.errors.join("\n"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rejects incomplete coverage, artifact tampering, and unsafe closure notes", async () => {
  const { fixture, finding, rootDir, reference } = await createCompleteFindingFixture();
  try {
    finding.closure.evidence[0].covers = [0];
    finding.closure.evidence[0].summary = "Customer phone number: 0781234567 and access_token=unsafe";
    await writeFile(join(rootDir, reference), "{}");
    const result = await validateAuditImplementationRegister(fixture, {
      verifyEvidence: false,
      rootDir,
      now: new Date("2026-07-18T11:00:00+02:00"),
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /acceptance index 1 has no closure evidence/);
    assert.match(result.errors.join("\n"), /local evidence SHA-256 does not match/);
    assert.match(result.errors.join("\n"), /summary contains prohibited identity or secret material/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("strict closure remains closed until every finding and strategic decision is terminal", async () => {
  const result = await validateAuditImplementationRegister(register, { strict: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /P0-1: strict audit closure requires complete or owner_declined status/);
  assert.match(result.errors.join("\n"), /S4-1: strict audit closure requires a terminal accountable decision/);
  assert.doesNotMatch(result.errors.join("\n"), /P2-2: strict audit closure/);
});

test("rejects drift from the exact source audit revision", async () => {
  const fixture = structuredClone(register);
  fixture.audit.source_revision = "stale-audit-revision";
  const result = await validateAuditImplementationRegister(fixture, { verifyEvidence: false });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /exact current revision/);
});

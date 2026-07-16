import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOsvResults,
  collectPinnedRequirements,
  parsePinnedRequirement,
} from "../scripts/audit-python-requirements.mjs";

test("parses exact Python pins and normalizes package names and extras", () => {
  assert.deepEqual(parsePinnedRequirement("ImageHash==4.3.2", "images.txt"), {
    name: "imagehash",
    displayName: "ImageHash",
    extras: [],
    version: "4.3.2",
    source: "images.txt",
  });
  assert.deepEqual(parsePinnedRequirement("rembg[cpu]==2.0.76 # controlled runtime", "images.txt"), {
    name: "rembg",
    displayName: "rembg",
    extras: ["cpu"],
    version: "2.0.76",
    source: "images.txt",
  });
  assert.equal(parsePinnedRequirement("  # comment only", "images.txt"), null);
});

test("rejects ranges, directives, malformed pins and conflicting versions", () => {
  assert.throws(() => parsePinnedRequirement("selenium>=4.30,<5", "scraper.txt"), /must pin/);
  assert.throws(() => parsePinnedRequirement("-r shared.txt", "scraper.txt"), /unsupported/);
  assert.throws(() => collectPinnedRequirements([
    { source: "first.txt", text: "Pillow==12.2.0\n" },
    { source: "second.txt", text: "pillow==12.3.0\n" },
  ]), /conflicting pins/);
});

test("passes a complete OSV result set with no advisories", () => {
  const requirements = collectPinnedRequirements([
    { source: "requirements.txt", text: "Pillow==12.3.0\nrembg[cpu]==2.0.76\n" },
  ]);
  assert.deepEqual(assessOsvResults(requirements, [{}, { vulns: [] }]), {
    status: "passed",
    ecosystem: "PyPI",
    packageCount: 2,
    vulnerablePackageCount: 0,
    findings: [],
  });
});

test("fails closed on advisories or an incomplete OSV response", () => {
  const requirements = collectPinnedRequirements([
    { source: "requirements.txt", text: "Pillow==11.3.0\n" },
  ]);
  const result = assessOsvResults(requirements, [{
    vulns: [{ id: "GHSA-example" }, { id: "GHSA-example" }, { id: "PYSEC-example" }],
  }]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings[0].advisoryIds, ["GHSA-example", "PYSEC-example"]);
  assert.throws(() => assessOsvResults(requirements, []), /incomplete/);
});

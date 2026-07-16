import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessDomainDns } from "../scripts/verify-domain-dns.mjs";

const plan = JSON.parse(await readFile(
  new URL("../docs/launch/dns/med250-cloudflare-domain-plan.json", import.meta.url),
  "utf8",
));

test("accepts a resolved Cloudflare production hostname", () => {
  const observed = { "A:med250.gikundiro.com": ["203.0.113.10", "203.0.113.11"] };
  const result = assessDomainDns(plan, observed);
  assert.equal(result.status, "passed");
  assert.equal(result.matchingRecordCount, result.recordCount);
  assert.equal(result.productionReady, false);
});

test("does not treat an empty answer as sufficient for a minimum-count record", () => {
  const result = assessDomainDns(plan, { "A:med250.gikundiro.com": [] });
  assert.equal(result.status, "pending");
  assert.equal(result.productionReady, false);
});

test("reports pending when the production hostname does not resolve", () => {
  const observed = { "A:med250.gikundiro.com": [] };
  const result = assessDomainDns(plan, observed);
  assert.equal(result.status, "pending");
  assert.equal(result.matchingRecordCount, 0);
  assert.equal(result.records[0].minimumCount, 1);
});

test("normalizes DNS trailing dots and reports unexpected answers without masking required matches", () => {
  const exactPlan = {
    hostnames: [{ records: [{ type: "CNAME", name: "www.example.com", values: ["target.example.com"], purpose: "test" }] }],
  };
  const result = assessDomainDns(exactPlan, { "CNAME:www.example.com": ["target.example.com.", "unexpected.example."] });
  const cname = result.records.find((record) => record.type === "CNAME");
  assert.equal(cname.matches, true);
  assert.deepEqual(cname.unexpected, ["unexpected.example"]);
});

test("does not lowercase case-sensitive TXT ownership values", () => {
  const key = "TXT:_verification.example.com";
  const exactPlan = {
    hostnames: [{ records: [{ type: "TXT", name: "_verification.example.com", values: ["CaseSensitiveToken"], purpose: "test" }] }],
  };
  const result = assessDomainDns(exactPlan, { [key]: ["casesensitivetoken"] });
  const ownership = result.records.find((record) => `${record.type}:${record.name}` === key);
  assert.equal(result.status, "pending");
  assert.equal(ownership.matches, false);
  assert.equal(ownership.missing.length, 1);
});

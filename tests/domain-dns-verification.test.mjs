import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessDomainDns } from "../scripts/verify-domain-dns.mjs";

const plan = JSON.parse(await readFile(
  new URL("../docs/launch/dns/med250-sites-domain-plan.json", import.meta.url),
  "utf8",
));

function expectedObserved() {
  return Object.fromEntries(plan.hostnames.flatMap((hostname) => hostname.records).map((record) => [
    `${record.type}:${record.name}`,
    record.values,
  ]));
}

test("accepts the exact provider-issued apex, CNAME and validation records", () => {
  const result = assessDomainDns(plan, expectedObserved());
  assert.equal(result.status, "passed");
  assert.equal(result.matchingRecordCount, result.recordCount);
  assert.equal(result.productionReady, false);
});

test("reports pending when routing or validation records are absent", () => {
  const observed = expectedObserved();
  observed["A:med250.rw"] = [];
  observed["TXT:_cf-custom-hostname.www.med250.rw"] = [];
  const result = assessDomainDns(plan, observed);
  assert.equal(result.status, "pending");
  assert.equal(result.matchingRecordCount, result.recordCount - 2);
  assert.ok(result.records.some((record) => record.name === "med250.rw" && record.missing.length === 2));
});

test("normalizes DNS trailing dots and reports unexpected answers without masking required matches", () => {
  const observed = expectedObserved();
  observed["CNAME:www.med250.rw"] = ["custom-domains.chatgpt.site.", "unexpected.example."];
  const result = assessDomainDns(plan, observed);
  const cname = result.records.find((record) => record.type === "CNAME");
  assert.equal(cname.matches, true);
  assert.deepEqual(cname.unexpected, ["unexpected.example"]);
});

test("does not lowercase case-sensitive TXT ownership values", () => {
  const observed = expectedObserved();
  const key = "TXT:_openai-site-verification.med250.rw";
  observed[key] = observed[key].map((value) => value.toLowerCase());
  const result = assessDomainDns(plan, observed);
  const ownership = result.records.find((record) => `${record.type}:${record.name}` === key);
  assert.equal(result.status, "pending");
  assert.equal(ownership.matches, false);
  assert.equal(ownership.missing.length, 1);
});

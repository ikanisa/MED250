import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rosterManifest = JSON.parse(await readFile(
  new URL("../data/imports/rwanda-fda-pharmacy-contacts-manifest.json", import.meta.url),
  "utf8",
));
const matchedContacts = await readFile(
  new URL("../data/imports/rwanda-fda-pharmacy-contacts-jul-sep-2026.csv", import.meta.url),
);
const retailRegistry = await readFile(
  new URL("../data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", import.meta.url),
);

const expectedRosters = new Set([
  "bugesera",
  "huye",
  "kamonyi",
  "kayonza",
  "kigali",
  "muhanga",
  "musanze",
  "nyagatare",
  "rubavu",
  "ruhango",
  "rwamagana",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Rwanda FDA duty-roster provenance binds every official source PDF", () => {
  assert.equal(rosterManifest.roster_pdfs_processed, 11);
  assert.deepEqual(new Set(Object.keys(rosterManifest.roster_sources)), expectedRosters);
  for (const [name, source] of Object.entries(rosterManifest.roster_sources)) {
    assert.match(source.url, /^https:\/\/monitoring\.rwandafda\.gov\.rw\/.+\.pdf$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/, `${name} must have an exact SHA-256 digest`);
  }
  assert.doesNotMatch(JSON.stringify(rosterManifest), /placeholder|regenerate-with/i);
});

test("duty-roster provenance remains bound to the governed derived datasets", () => {
  assert.equal(sha256(matchedContacts), rosterManifest.matched_contacts_sha256);
  assert.equal(sha256(retailRegistry), rosterManifest.retail_registry_sha256);
  assert.equal(rosterManifest.matched_contact_rows, 288);
  assert.equal(rosterManifest.matched_pharmacies, 267);
});

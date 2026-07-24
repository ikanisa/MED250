import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recoveryScript = await readFile(
  new URL("../scripts/recover-public-marketplace-catalogue.mjs", import.meta.url),
  "utf8",
);

test("public recovery remains explicitly separate from the missing private source", () => {
  assert.match(recoveryScript, /reconstructed_public_catalogue_evidence/);
  assert.match(recoveryScript, /This is not the missing corrected Amazon research dataset/);
  assert.match(recoveryScript, /originalSourceRecovered: false/);
  assert.match(recoveryScript, /recovery_manifest_not_source_retention_approval/);
  assert.match(recoveryScript, /5000580eb85403a58de8e604bdd055b25b22958ae5755206913a070bcae31383/);
});

test("public recovery fails closed unless catalogue identities and governed exclusions reconcile", () => {
  assert.match(recoveryScript, /localRows\.length !== 2_200/);
  assert.match(recoveryScript, /publicRows\.length !== 2_198/);
  assert.match(recoveryScript, /fdaMedicines\.length !== 2_480/);
  assert.match(recoveryScript, /unexpectedPublicIds\.length/);
  assert.match(recoveryScript, /absentIds\.length !== 2/);
  assert.match(recoveryScript, /indicative_price_basis === "rwanda_observed_catalogue"/);
  assert.match(recoveryScript, /!== 128/);
});

test("public recovery never embeds or prints the discovered public credential", () => {
  const consoleOutput = recoveryScript.slice(recoveryScript.lastIndexOf("console.log("));
  assert.doesNotMatch(consoleOutput, /publishableKey/);
  assert.match(recoveryScript, /apikey: publishableKey/);
  assert.match(recoveryScript, /Authorization: `Bearer \$\{publishableKey\}`/);
});

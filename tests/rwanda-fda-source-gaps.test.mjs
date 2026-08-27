import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceGapAudit, parseRegisteredProductsHtml } from "../scripts/audit-rwanda-fda-source-gaps.mjs";

const html = `
  <h1 class="reg-title"><u>LIST OF REGISTERED PHARMACEUTICAL PRODUCTS — AUGUST 2026</u></h1>
  <table><tbody>
    <tr class="hm-reg-row d-none">
      <td class="sn">0</td><td>RW-1</td><td>Brand &amp; One</td><td>Ingredient</td><td>—</td><td>Tablet</td><td>—</td><td>24</td><td>Maker</td><td>Rwanda</td><td>MAH</td><td>LTR</td><td>01/01/2026</td><td>01/01/2031</td>
    </tr>
  </tbody></table>`;

test("parses the public authority register without treating em dashes as product data", () => {
  const parsed = parseRegisteredProductsHtml(html);
  assert.match(parsed.title, /AUGUST 2026/);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0][2], "Brand & One");
  assert.equal(parsed.rows[0][4], "");
});

test("binds every source gap to the exact product registration", () => {
  const result = buildSourceGapAudit({
    html,
    products: [{ id: "p1", registrationNumber: "RW-1", generic: "Ingredient", strength: "", packSize: "", manufacturer: "Maker" }],
    observedAt: "2026-08-27T12:00:00Z",
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.audit.counts, { generic: 0, strength: 1, packSize: 1, manufacturer: 0 });
  assert.deepEqual(result.audit.missing.strength, [{ id: "p1", registrationNumber: "RW-1" }]);
});

test("rejects publication drift when the live authority has a missing local value", () => {
  const result = buildSourceGapAudit({
    html,
    products: [{ id: "p1", registrationNumber: "RW-1", generic: "", strength: "", packSize: "", manufacturer: "Maker" }],
  });
  assert.match(result.errors.join(" "), /generic is available/);
});

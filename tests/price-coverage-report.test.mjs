import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { priceCoverageMarkdown, summarizePriceCoverage } from "../scripts/report-price-coverage.mjs";

let datasetSource;
try {
  datasetSource = await readFile(
    new URL("../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json", import.meta.url),
    "utf8",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  datasetSource = await readFile(
    new URL("../outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json", import.meta.url),
    "utf8",
  );
}
const dataset = JSON.parse(datasetSource);

test("reports governed central price coverage without overstating Goal 3 completion", () => {
  const report = summarizePriceCoverage(dataset, new Date("2026-07-18T23:59:59Z"));
  assert.equal(report.catalogueProductCount, 4_680);
  assert.equal(report.pricedProductCount, 128);
  assert.equal(report.medicinePricedCount, 0);
  assert.equal(report.consumerPricedCount, 128);
  assert.equal(report.unsafeMetadataCount, 0);
  assert.equal(report.amazonDerivedPriceCount, 0);
  assert.equal(report.target.countThresholdMet, true);
  assert.equal(report.target.medicineAndConsumerCoverageMet, false);
  assert.equal(report.target.ownerApprovedPrioritySet, false);
  assert.deepEqual(report.sourceCounts, [
    { name: "Kasha Rwanda live product API", count: 118 },
    { name: "Kigali Protein Store", count: 10 },
  ]);
  assert.deepEqual(report.freshnessCounts, [{ name: "0–30 days", count: 128 }]);

  const markdown = priceCoverageMarkdown(report);
  assert.match(markdown, /technical evidence complete; product\/data-owner approval pending/);
  assert.match(markdown, /current set has 0 medicine prices/);
  assert.match(markdown, /not pharmacy-specific stock/);
  assert.doesNotMatch(markdown, /Goal 3 is complete/i);
});

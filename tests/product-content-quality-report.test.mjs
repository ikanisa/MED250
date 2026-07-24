import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { productContentQualityMarkdown, summarizeProductContentQuality } from "../scripts/report-product-content-quality.mjs";

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

test("reports product-content gaps without treating unreviewed exceptions as complete", () => {
  const report = summarizeProductContentQuality(dataset, new Date("2026-07-18T23:59:59Z"));
  assert.equal(report.catalogueProductCount, 4_680);
  assert.equal(report.blankOfficialTitleCount, 0);
  assert.equal(report.shortOrPackLikeTitleCount, 8);
  assert.equal(report.displayTitleOver120Count, 0);
  assert.equal(report.officialTitleOver180Count, 458);
  assert.equal(report.duplicateTitleGroupCount, 40);
  assert.equal(report.consumerDuplicateTitleGroupCount, 0);
  assert.equal(report.missingGenericMedicineCount, 24);
  assert.equal(report.dedicatedDescriptionCount, 0);
  assert.equal(report.prohibitedReferenceCount, 0);
  assert.equal(report.closure.customerDisplayTitleRuleImplemented, true);
  assert.equal(report.closure.prohibitedReferencesRemoved, true);
  assert.equal(report.closure.duplicateTitleReviewApproved, false);
  assert.equal(report.status, "requires_review");

  const markdown = productContentQualityMarkdown(report);
  assert.match(markdown, /Goal 8 is not closed/);
  assert.match(markdown, /rights-safe description schema/);
  assert.match(markdown, /duplicate medicine-title groups/);
  assert.match(markdown, /source-digest-bound packet/);
  assert.match(markdown, /72 review entries/);
});

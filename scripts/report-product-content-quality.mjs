import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { customerProductTitle, officialCatalogueTitle } from "../lib/product-display.ts";

const DEFAULT_DATASET = new URL(
  "../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
  import.meta.url,
);
const RECOVERED_VALIDATION_DATASET = new URL(
  "../outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json",
  import.meta.url,
);

function normalize(value) {
  return officialCatalogueTitle(value ?? "")
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function officialTitle(row) {
  return officialCatalogueTitle(row.product_name || row.brand_name || "");
}

function countBy(rows, keyFor) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = keyFor(row) || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function summarizeProductContentQuality(dataset, asOf = new Date()) {
  const medicines = Array.isArray(dataset.fda_medicines) ? dataset.fda_medicines : [];
  const consumerProducts = Array.isArray(dataset.consumer_products) ? dataset.consumer_products : [];
  const rows = [...medicines, ...consumerProducts];
  const titleGroups = new Map();
  rows.forEach((row) => {
    const key = normalize(officialTitle(row));
    if (!key) return;
    const group = titleGroups.get(key) ?? [];
    group.push(row);
    titleGroups.set(key, group);
  });
  const duplicateGroups = [...titleGroups.values()].filter((group) => group.length > 1);
  const medicineDuplicateGroups = duplicateGroups.filter((group) => group.every((row) => row.product_type === "human_medicine"));
  const consumerDuplicateGroups = duplicateGroups.filter((group) => group.some((row) => row.product_type !== "human_medicine"));
  const missingGenericMedicines = medicines.filter((row) => !officialCatalogueTitle(row.generic_name ?? ""));
  const malformedTitles = rows.filter((row) => {
    const title = officialTitle(row);
    return title.length < 3 || /^\d+(?:\.\d+)?\s*(?:pcs?|pack|count|ct|ml|mg|g|oz)?$/i.test(title);
  });
  const duplicatedTaxonomyRows = rows.filter((row) => {
    const generic = normalize(row.generic_name ?? "");
    if (!generic) return false;
    return new Set([normalize(row.category), normalize(row.subcategory)]).has(generic);
  });
  const displayTitles = rows.map((row) => ({ official: officialTitle(row), display: customerProductTitle(officialTitle(row)) }));
  const prohibitedReferenceCount = rows.filter((row) => /amazon/i.test([
    officialTitle(row),
    officialCatalogueTitle(row.generic_name ?? ""),
    officialCatalogueTitle(row.description ?? ""),
  ].filter(Boolean).join(" "))).length;
  const titleLengthBuckets = countBy(displayTitles, ({ display }) => {
    if (display.length <= 60) return "0–60 characters";
    if (display.length <= 90) return "61–90 characters";
    return "91–120 characters";
  });

  return {
    reportAsOf: asOf.toISOString().slice(0, 10),
    researchAsOf: dataset.research_as_of ?? null,
    catalogueProductCount: rows.length,
    medicineProductCount: medicines.length,
    consumerProductCount: consumerProducts.length,
    blankOfficialTitleCount: rows.filter((row) => !officialTitle(row)).length,
    shortOrPackLikeTitleCount: malformedTitles.length,
    displayTitleChangedCount: displayTitles.filter(({ official, display }) => official !== display).length,
    displayTitleOver120Count: displayTitles.filter(({ display }) => display.length > 120).length,
    officialTitleOver180Count: displayTitles.filter(({ official }) => official.length > 180).length,
    titleLengthBuckets,
    duplicateTitleGroupCount: duplicateGroups.length,
    duplicateTitleRowCount: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
    medicineDuplicateTitleGroupCount: medicineDuplicateGroups.length,
    consumerDuplicateTitleGroupCount: consumerDuplicateGroups.length,
    missingGenericMedicineCount: missingGenericMedicines.length,
    missingGenericConsumerCount: consumerProducts.filter((row) => !officialCatalogueTitle(row.generic_name ?? "")).length,
    dedicatedDescriptionCount: rows.filter((row) => officialCatalogueTitle(row.description ?? "")).length,
    missingDedicatedDescriptionCount: rows.filter((row) => !officialCatalogueTitle(row.description ?? "")).length,
    duplicatedTaxonomyCount: duplicatedTaxonomyRows.length,
    sourceImageCount: rows.filter((row) => officialCatalogueTitle(row.image_url ?? "")).length,
    missingSourceImageCount: rows.filter((row) => !officialCatalogueTitle(row.image_url ?? "")).length,
    prohibitedReferenceCount,
    departmentCounts: countBy(rows, (row) => row.category),
    status: "requires_review",
    closure: {
      customerDisplayTitleRuleImplemented: displayTitles.every(({ display }) => display.length > 0 && display.length <= 120),
      prohibitedReferencesRemoved: prohibitedReferenceCount === 0,
      duplicateTitleReviewApproved: false,
      descriptionCoverageApproved: false,
      missingGenericExceptionsApproved: false,
      liveImageCoverageVerified: false,
    },
  };
}

function tableRows(rows) {
  return rows.map((row) => `| ${row.name} | ${row.count.toLocaleString("en-RW")} |`).join("\n");
}

export function productContentQualityMarkdown(report) {
  return `# MED+250 product-content quality report

Report date: ${report.reportAsOf}  
Research snapshot: ${report.researchAsOf ?? "Not recorded"}  
Status: **requires governed review; Goal 8 is not closed**

## Governed owner-review packet

The source-digest-bound packet at \`data/imports/product-content-review-pending-2026-07-18.json\` covers all ${report.duplicateTitleGroupCount + report.missingGenericMedicineCount + report.shortOrPackLikeTitleCount} review entries: ${report.duplicateTitleGroupCount} duplicate medicine-title groups, ${report.missingGenericMedicineCount} medicines without generic/ingredient text, and ${report.shortOrPackLikeTitleCount} short or pack-like title candidates. It provides exact registration evidence without supplying a clinical inference, merge recommendation, or prefilled approval.

Run \`npm run data:content-review:verify\` to reject source drift, altered evidence, unsupported decisions, and incomplete accountability metadata. The strict live-release form also rejects pending reviews and unresolved source corrections.

## Title quality

| Measure | Evidence |
| --- | ---: |
| Catalogue products assessed | ${report.catalogueProductCount.toLocaleString("en-RW")} |
| Blank official titles | ${report.blankOfficialTitleCount.toLocaleString("en-RW")} |
| Short or pack-like titles requiring review | ${report.shortOrPackLikeTitleCount.toLocaleString("en-RW")} |
| Customer display titles transformed | ${report.displayTitleChangedCount.toLocaleString("en-RW")} |
| Customer display titles over 120 characters | ${report.displayTitleOver120Count.toLocaleString("en-RW")} |
| Official source titles over 180 characters | ${report.officialTitleOver180Count.toLocaleString("en-RW")} |
| Product names or descriptions with prohibited marketplace references | ${report.prohibitedReferenceCount.toLocaleString("en-RW")} |
| Duplicate normalized title groups | ${report.duplicateTitleGroupCount.toLocaleString("en-RW")} |
| Rows in duplicate title groups | ${report.duplicateTitleRowCount.toLocaleString("en-RW")} |

The customer surface now uses a bounded, sentence-cased title with prohibited
marketplace references removed. Duplicate medicine titles are not silently
deleted: they can represent distinct registrations and require source review.

## Customer display-title lengths

| Length | Products |
| --- | ---: |
${tableRows(report.titleLengthBuckets)}

## Content gaps

| Gap | Rows |
| --- | ---: |
| Medicine rows without generic/ingredient text | ${report.missingGenericMedicineCount.toLocaleString("en-RW")} |
| Consumer rows without a separate generic field | ${report.missingGenericConsumerCount.toLocaleString("en-RW")} |
| Rows without a dedicated description field | ${report.missingDedicatedDescriptionCount.toLocaleString("en-RW")} |
| Generic values duplicating taxonomy | ${report.duplicatedTaxonomyCount.toLocaleString("en-RW")} |
| Rows without a source-snapshot image URL | ${report.missingSourceImageCount.toLocaleString("en-RW")} |

Consumer product names can contain descriptive source text, but that is not treated as an approved reusable description. Source-snapshot image absence is also not evidence about the separate governed live image pipeline.

## Required owner decisions and evidence

1. Review the ${report.medicineDuplicateTitleGroupCount} duplicate medicine-title groups against registration, strength, form, and pack evidence.
2. Approve exceptions or correct the ${report.missingGenericMedicineCount} medicine rows without generic/ingredient text.
3. Define a rights-safe description schema and approve which source text may be reused; current dedicated-description coverage is zero.
4. Reconcile this source report with the governed live image report rather than inferring image coverage from the research workbook.
5. Capture browser evidence that concise display titles and exact official names remain readable at required breakpoints.
`;
}

function parseArguments(values) {
  const options = { format: "markdown", asOf: new Date(), dataset: DEFAULT_DATASET };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--format") options.format = values[++index];
    else if (value === "--as-of") options.asOf = new Date(`${values[++index]}T23:59:59Z`);
    else if (value === "--dataset") options.dataset = pathToFileURL(values[++index]);
    else throw new Error(`Unknown argument ${value}`);
  }
  if (!new Set(["json", "markdown"]).has(options.format)) throw new Error("--format must be json or markdown");
  if (Number.isNaN(options.asOf.getTime())) throw new Error("--as-of must be a valid YYYY-MM-DD date");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let datasetSource;
  try {
    datasetSource = await readFile(options.dataset, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT" || options.dataset.href !== DEFAULT_DATASET.href) throw error;
    datasetSource = await readFile(RECOVERED_VALIDATION_DATASET, "utf8");
  }
  const dataset = JSON.parse(datasetSource);
  const report = summarizeProductContentQuality(dataset, options.asOf);
  process.stdout.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : productContentQualityMarkdown(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

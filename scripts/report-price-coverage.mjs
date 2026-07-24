import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_DATASET = new URL(
  "../outputs/019f66ce-d480-7a90-9bb7-ee6e417b5ce7/corrected/research/corrected-catalog-dataset-2026-07-15.json",
  import.meta.url,
);
const RECOVERED_VALIDATION_DATASET = new URL(
  "../outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json",
  import.meta.url,
);
const MINIMUM_PRICE_TARGET = 100;

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

function ageInDays(value, asOf) {
  const observed = Date.parse(value ?? "");
  if (!Number.isFinite(observed)) return null;
  return Math.max(0, Math.floor((asOf.getTime() - observed) / 86_400_000));
}

function freshnessBucket(days) {
  if (days === null) return "Unknown";
  if (days <= 30) return "0–30 days";
  if (days <= 90) return "31–90 days";
  if (days <= 180) return "91–180 days";
  return "181+ days";
}

function hasSafePriceMetadata(row) {
  const price = Number(row.indicative_price_rwf);
  const sourceUrl = String(row.indicative_price_source_url ?? "");
  const updatedAt = Date.parse(row.indicative_price_updated_at ?? "");
  return Number.isInteger(price)
    && price > 0
    && row.indicative_price_basis === "rwanda_observed_catalogue"
    && sourceUrl.startsWith("https://")
    && !/amazon\./i.test(sourceUrl)
    && Number.isFinite(updatedAt);
}

export function summarizePriceCoverage(dataset, asOf = new Date()) {
  const medicines = Array.isArray(dataset.fda_medicines) ? dataset.fda_medicines : [];
  const consumerProducts = Array.isArray(dataset.consumer_products) ? dataset.consumer_products : [];
  const allProducts = [...medicines, ...consumerProducts];
  const pricedProducts = allProducts.filter((row) => Number(row.indicative_price_rwf) > 0);
  const prices = pricedProducts.map((row) => Number(row.indicative_price_rwf)).toSorted((a, b) => a - b);
  const medicinePricedCount = pricedProducts.filter((row) => row.category === "Medicines" || row.product_type === "human_medicine").length;
  const consumerPricedCount = pricedProducts.length - medicinePricedCount;
  const unsafeMetadataCount = pricedProducts.filter((row) => !hasSafePriceMetadata(row)).length;
  const sourceCounts = countBy(pricedProducts, (row) => row.rwanda_source_name || new URL(row.indicative_price_source_url).hostname);
  const departmentCounts = countBy(pricedProducts, (row) => row.category);
  const freshnessCounts = countBy(pricedProducts, (row) => freshnessBucket(ageInDays(row.indicative_price_updated_at, asOf)));
  const observationDates = pricedProducts
    .map((row) => row.indicative_price_updated_at)
    .filter(Boolean)
    .toSorted();

  return {
    reportAsOf: asOf.toISOString().slice(0, 10),
    datasetGeneratedAt: dataset.generated_at ?? null,
    researchAsOf: dataset.research_as_of ?? null,
    catalogueProductCount: allProducts.length,
    medicineProductCount: medicines.length,
    consumerProductCount: consumerProducts.length,
    pricedProductCount: pricedProducts.length,
    medicinePricedCount,
    consumerPricedCount,
    overallCoveragePercent: allProducts.length ? Number((pricedProducts.length / allProducts.length * 100).toFixed(2)) : 0,
    priceRangeRwf: prices.length ? { minimum: prices[0], median: prices[Math.floor(prices.length / 2)], maximum: prices.at(-1) } : null,
    sourceCounts,
    departmentCounts,
    freshnessCounts,
    oldestObservation: observationDates[0] ?? null,
    newestObservation: observationDates.at(-1) ?? null,
    unsafeMetadataCount,
    amazonDerivedPriceCount: pricedProducts.filter((row) => row.indicative_price_basis === "amazon_usd_reference_conversion" || /amazon\./i.test(row.indicative_price_source_url ?? "")).length,
    target: {
      minimumPricedProducts: MINIMUM_PRICE_TARGET,
      countThresholdMet: pricedProducts.length >= MINIMUM_PRICE_TARGET,
      medicineAndConsumerCoverageMet: medicinePricedCount > 0 && consumerPricedCount > 0,
      ownerApprovedPrioritySet: false,
      ownerApprovalStatus: "pending_owner_approval",
    },
  };
}

function formatRwf(value) {
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(value);
}

function tableRows(rows) {
  return rows.map((row) => `| ${row.name} | ${row.count.toLocaleString("en-RW")} |`).join("\n");
}

export function priceCoverageMarkdown(report) {
  return `# MED+250 indicative-price coverage report

Report date: ${report.reportAsOf}  
Research snapshot: ${report.researchAsOf ?? "Not recorded"}  
Status: **technical evidence complete; product/data-owner approval pending**

## Summary

| Measure | Evidence |
| --- | ---: |
| Approved catalogue rows assessed | ${report.catalogueProductCount.toLocaleString("en-RW")} |
| Products with central indicative price | ${report.pricedProductCount.toLocaleString("en-RW")} |
| Overall catalogue coverage | ${report.overallCoveragePercent}% |
| Medicine products with price | ${report.medicinePricedCount.toLocaleString("en-RW")} |
| Consumer products with price | ${report.consumerPricedCount.toLocaleString("en-RW")} |
| Unsafe/incomplete price metadata | ${report.unsafeMetadataCount.toLocaleString("en-RW")} |
| Amazon-derived public prices | ${report.amazonDerivedPriceCount.toLocaleString("en-RW")} |

The numerical target of ${report.target.minimumPricedProducts} priced products is ${report.target.countThresholdMet ? "met" : "not met"}. This does **not** close Goal 3: the current set has ${report.medicinePricedCount} medicine prices, is not yet an owner-approved priority set, and still requires source-reuse, freshness, and correction-process approval.

## Coverage by department

| Department | Priced products |
| --- | ---: |
${tableRows(report.departmentCounts)}

## Evidence sources

| Rwanda source | Priced products |
| --- | ---: |
${tableRows(report.sourceCounts)}

## Observation age at report date

| Evidence age | Priced products |
| --- | ---: |
${tableRows(report.freshnessCounts)}

Oldest observation: ${report.oldestObservation ?? "Not recorded"}  
Newest observation: ${report.newestObservation ?? "Not recorded"}

## Price distribution

${report.priceRangeRwf ? `Minimum RWF ${formatRwf(report.priceRangeRwf.minimum)}; median RWF ${formatRwf(report.priceRangeRwf.median)}; maximum RWF ${formatRwf(report.priceRangeRwf.maximum)}.` : "No governed prices are present."}

These values are central, informational references. They are not pharmacy-specific stock, a pharmacy price list, or a final customer charge.

## Required owner decisions

1. Approve or replace the candidate priority-product set, including medicine representation.
2. Approve publication/reuse rights for every price source.
3. Set the maximum permitted evidence age and the refresh/expiry schedule.
4. Name the reviewer and correction/withdrawal owner.
5. Re-run this report against the approved live catalogue and attach deployed product samples before closing Goal 3.
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
  const report = summarizePriceCoverage(dataset, options.asOf);
  process.stdout.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : priceCoverageMarkdown(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

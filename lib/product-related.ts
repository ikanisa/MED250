export type RelatedCatalogueRecord = {
  id: string;
  kind: "medicine" | "consumer";
  brand: string;
  generic: string;
  strength: string;
  form: string;
  packSize: string;
  manufacturer: string;
  manufacturerCountry: string;
  registrationNumber: string;
  category: string;
  subcategory: string;
  productType: string;
  prescriptionStatus: string;
  regulatoryStatus: string;
  isRequestable: boolean;
  recommendable: boolean;
};

export type RelatedProductSeed = Pick<RelatedCatalogueRecord,
  "id" | "brand" | "generic" | "strength" | "form" | "packSize" | "manufacturer" | "category" | "subcategory" | "productType" | "prescriptionStatus"
> & { kind?: RelatedCatalogueRecord["kind"]; recommendable?: boolean };

const normalize = (value: string | undefined) => (value ?? "")
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase()
  .replace(/\s+/g, " ");

const doseEvidence = /(?:^|\s|\()\d+(?:[.,]\d+)?\s*(?:mcg|μg|mg|g|kg|ml|l|iu|units?|%)(?:\b|\/)/i;

function kindFor(product: RelatedProductSeed): RelatedCatalogueRecord["kind"] {
  if (product.kind) return product.kind;
  return product.id.startsWith("AMZ-") || normalize(product.productType) !== "human_medicine"
    ? "consumer"
    : "medicine";
}

function prescriptionCompatible(seed: RelatedProductSeed, candidate: RelatedCatalogueRecord) {
  const left = normalize(seed.prescriptionStatus);
  const right = normalize(candidate.prescriptionStatus);
  const unknown = new Set(["", "unclassified", "not_applicable"]);
  return unknown.has(left) || unknown.has(right) || left === right;
}

function medicineMatch(seed: RelatedProductSeed, candidate: RelatedCatalogueRecord) {
  const generic = normalize(seed.generic);
  const candidateGeneric = normalize(candidate.generic);
  const form = normalize(seed.form);
  const candidateForm = normalize(candidate.form);
  const strength = normalize(seed.strength);
  const candidateStrength = normalize(candidate.strength);
  if (!generic || generic !== candidateGeneric || !form || form !== candidateForm) return false;
  if (!doseEvidence.test(`${generic} ${strength}`) || !doseEvidence.test(`${candidateGeneric} ${candidateStrength}`)) return false;
  if ((strength || candidateStrength) && strength !== candidateStrength) return false;
  return prescriptionCompatible(seed, candidate);
}

function consumerMatch(seed: RelatedProductSeed, candidate: RelatedCatalogueRecord) {
  const category = normalize(seed.category);
  const subcategory = normalize(seed.subcategory);
  return Boolean(category && subcategory)
    && category === normalize(candidate.category)
    && subcategory === normalize(candidate.subcategory)
    && normalize(seed.brand) !== normalize(candidate.brand);
}

/**
 * Conservative catalogue similarity only. Medicine records require identical
 * recorded ingredient, dosage form and dose evidence; consumer records require
 * the same governed category and subcategory. This is browsing logic, never a
 * substitution or treatment recommendation.
 */
export function selectRelatedCatalogueRecords(
  seed: RelatedProductSeed,
  catalogue: RelatedCatalogueRecord[],
  limit = 8,
) {
  if (seed.recommendable === false) return [];
  const kind = kindFor(seed);
  const safeLimit = Math.max(0, Math.min(12, Math.trunc(limit)));
  return catalogue
    .filter((candidate) => candidate.isRequestable && candidate.recommendable && candidate.id !== seed.id && candidate.kind === kind)
    .filter((candidate) => kind === "medicine" ? medicineMatch(seed, candidate) : consumerMatch(seed, candidate))
    .map((candidate) => ({
      candidate,
      score: (normalize(seed.productType) && normalize(seed.productType) === normalize(candidate.productType) ? 8 : 0)
        + (normalize(seed.manufacturer) && normalize(seed.manufacturer) === normalize(candidate.manufacturer) ? 4 : 0)
        + (normalize(seed.packSize) && normalize(seed.packSize) === normalize(candidate.packSize) ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.candidate.brand.localeCompare(right.candidate.brand, "en", { numeric: true, sensitivity: "base" }))
    .slice(0, safeLimit)
    .map(({ candidate }) => candidate);
}

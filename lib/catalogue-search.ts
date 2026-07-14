import type { Product } from "./dawanear-client";

export type IndexedCatalogueProduct = {
  product: Product;
  brand: string;
  generic: string;
  details: string;
  tokens: string[];
};

export type ProductSearchMatch = {
  product: Product;
  score: number;
  explanation: string;
};

const conceptAliases: readonly (readonly string[])[] = [
  ["pain", "ache", "analgesic", "douleur", "ububabare", "paracetamol", "ibuprofen", "diclofenac"],
  ["headache", "migraine", "mal de tete", "umutwe", "kubabara umutwe", "paracetamol", "ibuprofen"],
  ["fever", "temperature", "fievre", "umuriro", "paracetamol", "ibuprofen"],
  ["allergy", "allergic", "antihistamine", "allergie", "allergique", "cetirizine", "loratadine"],
  ["cold", "cough", "flu", "decongestant", "rhume", "toux", "grippe", "ibicurane", "inkorora"],
  ["diabetes", "diabetic", "glucose", "diabete", "sukari", "insulin", "metformin"],
  ["heartburn", "reflux", "antacid", "brulures estomac", "igifu", "omeprazole", "esomeprazole"],
  ["stomach", "digestive", "diarrhoea", "nausea", "estomac", "digestif", "diarrhee", "igifu"],
  ["skin", "dermatology", "cream", "lotion", "topical", "peau", "uruhu"],
  ["baby", "infant", "child", "children", "pediatric", "bebe", "enfant", "uruhinja"],
  ["diaper", "nappy", "couche", "impuzu zuruhinja"],
  ["hygiene", "personal care", "oral", "soap", "hygiene personnelle", "isuku"],
  ["vitamin", "supplement", "wellness", "mineral", "vitamine", "complement"],
] as const;

const aliasIndex = new Map<string, Set<string>>();

export const MAX_CATALOGUE_QUERY_LENGTH = 160;

export function boundedCatalogueQuery(value: string) {
  return value.slice(0, MAX_CATALOGUE_QUERY_LENGTH);
}

export function normalizeCatalogueText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9%+./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

for (const group of conceptAliases) {
  const normalizedGroup = group.map(normalizeCatalogueText);
  for (const term of normalizedGroup) {
    const aliases = aliasIndex.get(term) ?? new Set<string>();
    normalizedGroup.forEach((alias) => aliases.add(alias));
    aliasIndex.set(term, aliases);
  }
}

function queryConcepts(query: string) {
  const normalized = normalizeCatalogueText(boundedCatalogueQuery(query));
  const direct = normalized.split(" ").filter(Boolean);
  const concepts = new Set(direct);
  for (const [phrase, aliases] of aliasIndex) {
    if (normalized === phrase || normalized.includes(` ${phrase} `) || normalized.startsWith(`${phrase} `) || normalized.endsWith(` ${phrase}`)) {
      aliases.forEach((alias) => concepts.add(alias));
    }
  }
  return { normalized, direct: new Set(direct), concepts: [...concepts] };
}

function tokenSimilarity(query: string, candidate: string) {
  if (query === candidate) return 1;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return .82;
  if (candidate.includes(query) || query.includes(candidate)) return .68;
  if (query.length < 4 || candidate.length < 4) return 0;
  const queryPairs = new Set(Array.from({ length: query.length - 1 }, (_, index) => query.slice(index, index + 2)));
  const candidatePairs = new Set(Array.from({ length: candidate.length - 1 }, (_, index) => candidate.slice(index, index + 2)));
  let overlap = 0;
  queryPairs.forEach((pair) => { if (candidatePairs.has(pair)) overlap += 1; });
  return (2 * overlap) / (queryPairs.size + candidatePairs.size);
}

export function indexCatalogueProduct(product: Product): IndexedCatalogueProduct {
  const brand = normalizeCatalogueText(product.brand);
  const generic = normalizeCatalogueText(product.generic);
  const details = normalizeCatalogueText(`${product.strength} ${product.form} ${product.packSize} ${product.category} ${product.prescriptionStatus}`);
  return { product, brand, generic, details, tokens: `${brand} ${generic} ${details}`.split(" ").filter(Boolean) };
}

function scoreProduct(indexed: IndexedCatalogueProduct, query: string) {
  const { normalized, direct, concepts } = queryConcepts(query);
  if (!normalized) return 1;
  let score = 0;
  if (indexed.brand === normalized) score += 250;
  else if (indexed.brand.startsWith(normalized)) score += 180;
  else if (indexed.brand.includes(normalized)) score += 140;
  if (indexed.generic === normalized) score += 210;
  else if (indexed.generic.includes(normalized)) score += 125;
  if (indexed.details.includes(normalized)) score += 80;
  for (const term of concepts) {
    const termTokens = term.split(" ").filter(Boolean);
    for (const token of termTokens) {
      if (indexed.tokens.includes(token)) {
        // An exact product token reached through a recognised symptom/language
        // alias is stronger evidence than a fuzzy spelling resemblance to the
        // raw query. This keeps queries such as Kinyarwanda `umutwe` focused on
        // paracetamol/ibuprofen instead of similarly spelled brand names.
        score += direct.has(token) ? 72 : 96;
        continue;
      }
      if (token.length >= 4 && indexed.tokens.some((candidate) => candidate.startsWith(token) || (candidate.length >= 4 && token.startsWith(candidate)))) {
        score += direct.has(token) ? 55 : 64;
        continue;
      }
      if (!direct.has(token)) continue;
      let best = 0;
      for (const candidate of indexed.tokens) best = Math.max(best, tokenSimilarity(token, candidate));
      if (best >= .72) score += Math.round(best * 56);
    }
  }
  return score;
}

function isRelevant(indexed: IndexedCatalogueProduct, query: string, score: number) {
  const directTerms = normalizeCatalogueText(query).split(" ").filter(Boolean);
  if (!directTerms.length) return true;
  if (score < 42) return false;
  if (directTerms.length === 1) return true;
  const matchedDirectTerms = directTerms.filter((term) => indexed.tokens.some((token) => (
    token === term
    || (term.length >= 4 && (token.startsWith(term) || term.startsWith(token)))
    || tokenSimilarity(term, token) >= .76
  )));
  return matchedDirectTerms.length === directTerms.length || score >= 140;
}

function matchExplanation(indexed: IndexedCatalogueProduct, query: string) {
  const normalized = normalizeCatalogueText(query);
  if (!normalized) return "Catalogue product";
  if (indexed.brand === normalized) return "Exact product name";
  if (indexed.brand.includes(normalized)) return "Product name match";
  if (indexed.generic === normalized) return "Exact active ingredient";
  if (indexed.generic.includes(normalized)) return "Active ingredient match";
  if (indexed.details.includes(normalized)) return "Strength, form or category match";
  const direct = normalized.split(" ").filter(Boolean);
  if (direct.some((term) => indexed.tokens.some((token) => tokenSimilarity(term, token) >= .76))) return "Close spelling match";
  return "Related term match";
}

export function searchCatalogueProduct(indexed: IndexedCatalogueProduct, query: string): ProductSearchMatch | null {
  const score = scoreProduct(indexed, query);
  if (!isRelevant(indexed, query, score)) return null;
  return { product: indexed.product, score, explanation: matchExplanation(indexed, query) };
}

export function catalogueFormGroup(product: Product) {
  const form = normalizeCatalogueText(product.form);
  if (/tablet|caplet|capsule/.test(form)) return "tablets";
  if (/syrup|solution|suspension|drops|liquid/.test(form)) return "liquids";
  if (/injection|infusion|vial|ampoule/.test(form)) return "injections";
  if (/cream|ointment|gel|lotion|topical/.test(form)) return "topical";
  if (/device|meter|monitor|thermometer|inhaler/.test(form)) return "devices";
  return "other";
}

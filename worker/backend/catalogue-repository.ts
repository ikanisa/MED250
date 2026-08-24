import {
  allRows,
  d1Boolean,
  firstRow,
  inClause,
  parseJsonArray,
  type D1Row,
} from "../../db/index.ts";

export type CatalogueSearch = {
  query: string;
  category: string;
  prescriptionStatus: string;
  formGroup: string;
  availability: string;
  sort: "relevance" | "az" | "za" | "price";
  limit: number;
  offset: number;
};

export type CatalogueSearchReceipt = {
  products: Record<string, unknown>[];
  total: number;
};

export type CatalogueMedia = {
  r2Key: string;
  sha256: string;
};

const PRODUCT_ID = /^[A-Za-z0-9-]{1,80}$/;
const FUZZY_CANDIDATE_LIMIT = 10_000;

function value(row: D1Row, key: string): unknown {
  return Reflect.get(row, key);
}

function stringValue(row: D1Row, key: string): string {
  const found = value(row, key);
  if (typeof found !== "string" || !found) throw new Error(`Database field ${key} is invalid.`);
  return found;
}

function numberValue(row: D1Row, key: string): number {
  const parsed = Number(value(row, key));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Database field ${key} is invalid.`);
  return parsed;
}

function productIds(ids: string[], maximum: number): string[] {
  const unique = [...new Set(ids.map((id) => id.trim()))];
  if (!unique.length || unique.length > maximum || unique.some((id) => !PRODUCT_ID.test(id))) {
    throw new Error("Catalogue product identifiers are invalid.");
  }
  return unique;
}

function normalizedQuery(query: string): string {
  const normalized = query.trim().toLocaleLowerCase("en").slice(0, 160);
  const aliases = new Map([
    ["douleur", "paracetamol"], ["ububabare", "paracetamol"], ["mal de tête", "paracetamol"],
    ["umutwe", "paracetamol"], ["kubabara umutwe", "paracetamol"], ["fièvre", "paracetamol"],
    ["fievre", "paracetamol"], ["umuriro", "paracetamol"], ["allergie", "cetirizine"],
    ["allergique", "cetirizine"], ["rhume", "cough"], ["toux", "cough"], ["grippe", "cough"],
    ["ibicurane", "cough"], ["inkorora", "cough"], ["diabète", "metformin"], ["diabete", "metformin"],
    ["sukari", "metformin"], ["brûlures d'estomac", "omeprazole"], ["brulures d'estomac", "omeprazole"],
    ["igifu", "omeprazole"], ["peau", "skin"], ["uruhu", "skin"], ["bébé", "baby"],
    ["bebe", "baby"], ["enfant", "baby"], ["uruhinja", "baby"], ["couche", "diaper"],
    ["impuzu z'uruhinja", "diaper"], ["hygiène", "hygiene"], ["hygiene", "hygiene"],
    ["hygiène personnelle", "hygiene"], ["isuku", "hygiene"], ["vitamine", "vitamin"],
    ["complément", "vitamin"], ["complement", "vitamin"],
  ]);
  return aliases.get(normalized) ?? normalized;
}

function formCondition(group: CatalogueSearch["formGroup"]): string | null {
  const dosage = "lower(coalesce(product.dosage_form, ''))";
  const grouped: Record<string, string[]> = {
    tablets: ["tablet", "caplet", "capsule"],
    liquids: ["syrup", "solution", "suspension", "drops", "liquid"],
    injections: ["injection", "infusion", "vial", "ampoule"],
    topical: ["cream", "ointment", "gel", "lotion", "topical"],
    devices: ["device", "meter", "monitor", "thermometer", "inhaler"],
  };
  if (group === "all") return null;
  const terms = group === "other" ? Object.values(grouped).flat() : grouped[group] ?? [];
  const expression = terms.map((term) => `${dosage} LIKE '%${term}%'`).join(" OR ");
  return group === "other" ? `NOT (${expression})` : `(${expression})`;
}

function catalogueFilters(input: CatalogueSearch): { conditions: string[]; bindings: Array<string | number | null> } {
  const conditions = ["product.is_active = 1", "product.publication_status = 'approved'"];
  const bindings: Array<string | number | null> = [];
  if (input.category !== "All products") {
    conditions.push("(product.category = ? or product.department = ? or product.subcategory = ?)");
    bindings.push(input.category, input.category, input.category);
  }
  if (input.prescriptionStatus !== "all") {
    conditions.push("product.prescription_status = ?");
    bindings.push(input.prescriptionStatus);
  }
  const form = formCondition(input.formGroup);
  if (form) conditions.push(form);
  if (input.availability === "priced") conditions.push("product.indicative_price_rwf is not null");
  if (input.availability === "orderable") conditions.push("product.is_orderable = 1");
  if (input.availability === "registered") conditions.push("product.regulatory_status in ('valid', 'active', 'expiring_soon')");
  return { conditions, bindings };
}

function normalizeFuzzyText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9%+./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigramSimilarity(query: string, candidate: string): number {
  if (query === candidate) return 1;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 0.82;
  if (candidate.includes(query) || query.includes(candidate)) return 0.68;
  if (query.length < 4 || candidate.length < 4) return 0;
  const queryPairs = new Set(Array.from({ length: query.length - 1 }, (_, index) => query.slice(index, index + 2)));
  const candidatePairs = new Set(Array.from({ length: candidate.length - 1 }, (_, index) => candidate.slice(index, index + 2)));
  let overlap = 0;
  for (const pair of queryPairs) if (candidatePairs.has(pair)) overlap += 1;
  return (2 * overlap) / (queryPairs.size + candidatePairs.size);
}

type FuzzyMatch = { id: string; brand: string; price: number | null; score: number };

export function rankFuzzyCatalogueCandidates(rows: D1Row[], query: string, sort: CatalogueSearch["sort"]): FuzzyMatch[] {
  const queryTokens = normalizeFuzzyText(query).split(" ").filter((token) => token.length >= 4);
  if (!queryTokens.length) return [];
  const matches: FuzzyMatch[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!PRODUCT_ID.test(id)) throw new Error("Database field id is invalid.");
    const brand = String(row.brand_name ?? "");
    const candidateTokens = normalizeFuzzyText([
      brand, row.generic_name, row.strength, row.dosage_form,
      row.category, row.department, row.subcategory,
    ].join(" ")).split(" ").filter(Boolean);
    const similarities = queryTokens.map((token) => candidateTokens.reduce(
      (best, candidate) => Math.max(best, bigramSimilarity(token, candidate)),
      0,
    ));
    if (similarities.some((similarity) => similarity < 0.72)) continue;
    const priceValue = row.indicative_price_rwf;
    matches.push({
      id,
      brand,
      price: priceValue === null || priceValue === undefined ? null : numberValue(row, "indicative_price_rwf"),
      score: similarities.reduce((total, similarity) => total + Math.round(similarity * 56), 0),
    });
  }
  const byBrand = (left: FuzzyMatch, right: FuzzyMatch) => normalizeFuzzyText(left.brand).localeCompare(normalizeFuzzyText(right.brand)) || left.id.localeCompare(right.id);
  matches.sort((left, right) => {
    if (sort === "az") return byBrand(left, right);
    if (sort === "za") return byBrand(right, left);
    if (sort === "price") {
      if (left.price === null && right.price !== null) return 1;
      if (left.price !== null && right.price === null) return -1;
      if (left.price !== right.price) return (left.price ?? 0) - (right.price ?? 0);
      return byBrand(left, right);
    }
    return right.score - left.score || byBrand(left, right);
  });
  return matches;
}

function serializableProduct(row: D1Row): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  result.image_urls = parseJsonArray(row.image_urls ?? "[]", "image_urls");
  result.is_orderable = d1Boolean(row.is_orderable, "is_orderable");
  result.price_is_indicative = d1Boolean(row.price_is_indicative, "price_is_indicative");
  return result;
}

const PUBLIC_COLUMNS = `
  product.id,
  product.registration_number,
  product.brand_name,
  product.generic_name,
  product.strength,
  product.dosage_form,
  product.pack_size,
  product.product_type,
  product.category,
  product.department,
  product.subcategory,
  product.prescription_status,
  product.regulatory_status,
  product.manufacturer,
  product.manufacturer_country,
  product.expiry_date,
  (select '/api/catalogue/media/' || product.id || '/' || image.position
     from med250_product_images image
    where image.product_id = product.id and image.approved = 1
    order by image.position limit 1) as image_url,
  coalesce((select json_group_array('/api/catalogue/media/' || product.id || '/' || ordered.position)
     from (select position from med250_product_images image
            where image.product_id = product.id and image.approved = 1
            order by position) ordered), '[]') as image_urls,
  product.is_orderable,
  product.source_name,
  product.source_url,
  product.indicative_price_rwf as price_min_rwf,
  product.indicative_price_rwf as price_max_rwf,
  0 as price_contributors,
  product.indicative_price_rwf,
  case when product.indicative_price_rwf is null then 0 else 1 end as price_is_indicative,
  product.indicative_price_basis,
  product.indicative_price_source_url,
  product.indicative_price_updated_at,
  case when product.description_approved = 1 then product.description end as description,
  case when product.description_approved = 1 then product.description_source_name end as description_source_name,
  case when product.description_approved = 1 then product.description_source_url end as description_source_url`;

export class CatalogueRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async search(input: CatalogueSearch): Promise<CatalogueSearchReceipt> {
    const query = normalizedQuery(input.query);
    const filtered = catalogueFilters(input);
    const conditions = [...filtered.conditions];
    const bindings = [...filtered.bindings];
    if (query) {
      const like = `%${query}%`;
      conditions.push(`(
        lower(product.brand_name) like ?
        or lower(coalesce(product.generic_name, '')) like ?
        or lower(coalesce(product.strength, '')) like ?
        or lower(coalesce(product.dosage_form, '')) like ?
        or lower(coalesce(product.category, '')) like ?
        or lower(coalesce(product.department, '')) like ?
        or lower(coalesce(product.subcategory, '')) like ?
        or lower(coalesce(product.registration_number, '')) = ?
      )`);
      bindings.push(like, like, like, like, like, like, like, query);
    }

    const matchScore = query ? `case
      when lower(product.brand_name) = ? then 1000
      when lower(coalesce(product.generic_name, '')) = ? then 900
      when lower(product.brand_name) like ? then 700
      when lower(coalesce(product.generic_name, '')) like ? then 600
      else 100 end` : "1";
    const scoreBindings = query ? [query, query, `%${query}%`, `%${query}%`] : [];
    const orderBy = {
      relevance: "computed_match_score desc, lower(product.brand_name), product.id",
      az: "lower(product.brand_name), product.id",
      za: "lower(product.brand_name) desc, product.id",
      price: "product.indicative_price_rwf is null, product.indicative_price_rwf, lower(product.brand_name), product.id",
    }[input.sort];
    const rows = await allRows<D1Row>(this.database, `
      select ${PUBLIC_COLUMNS},
        ${matchScore} as computed_match_score,
        case
          when ? = '' then 'Catalogue product'
          when lower(product.brand_name) = ? then 'Exact product name'
          when lower(coalesce(product.generic_name, '')) = ? then 'Exact active ingredient'
          when lower(product.brand_name) like ? then 'Product name match'
          when lower(coalesce(product.generic_name, '')) like ? then 'Active ingredient match'
          else 'Strength, form or category match'
        end as match_explanation,
        count(*) over() as total_count
      from med250_catalogue_products product
      where ${conditions.join(" and ")}
      order by ${orderBy}
      limit ? offset ?
    `, [
      ...scoreBindings,
      query, query, query, `%${query}%`, `%${query}%`,
      ...bindings,
      input.limit, input.offset,
    ]);
    if (!rows.length && query) {
      const exactCount = await firstRow<D1Row>(this.database, `
        select count(*) as total_count
        from med250_catalogue_products product
        where ${conditions.join(" and ")}
      `, bindings);
      if (exactCount && numberValue(exactCount, "total_count") > 0) {
        return { products: [], total: numberValue(exactCount, "total_count") };
      }
      return this.fuzzySearch(input, query, filtered);
    }
    const total = rows[0] ? numberValue(rows[0], "total_count") : 0;
    return { products: rows.map(serializableProduct), total };
  }

  private async fuzzySearch(
    input: CatalogueSearch,
    query: string,
    filtered: { conditions: string[]; bindings: Array<string | number | null> },
  ): Promise<CatalogueSearchReceipt> {
    const candidates = await allRows<D1Row>(this.database, `
      select product.id, product.brand_name, product.generic_name, product.strength,
        product.dosage_form, product.category, product.department, product.subcategory,
        product.indicative_price_rwf
      from med250_catalogue_products product
      where ${filtered.conditions.join(" and ")}
      order by product.id
      limit ${FUZZY_CANDIDATE_LIMIT + 1}
    `, filtered.bindings);
    if (candidates.length > FUZZY_CANDIDATE_LIMIT) {
      throw new Error("Catalogue fuzzy candidate set exceeds the governed limit.");
    }
    const matches = rankFuzzyCatalogueCandidates(candidates, query, input.sort);
    const selected = matches.slice(input.offset, input.offset + input.limit);
    if (!selected.length) return { products: [], total: matches.length };
    const rows: D1Row[] = [];
    for (let index = 0; index < selected.length; index += 100) {
      const ids = selected.slice(index, index + 100).map(({ id }) => id);
      rows.push(...await allRows<D1Row>(this.database, `
        select ${PUBLIC_COLUMNS}
        from med250_catalogue_products product
        where product.id in (${inClause(ids.length)})
          and product.is_active = 1 and product.publication_status = 'approved'
      `, ids));
    }
    const rowsById = new Map(rows.map((row) => [stringValue(row, "id"), row]));
    return {
      products: selected.map((match) => {
        const row = rowsById.get(match.id);
        if (!row) throw new Error("Fuzzy catalogue result disappeared during readback.");
        return serializableProduct({ ...row, computed_match_score: match.score, match_explanation: "Close spelling match" });
      }),
      total: matches.length,
    };
  }

  async taxonomy(): Promise<Record<string, unknown>[]> {
    return allRows(this.database, `
      select department, subcategory, product_count
      from med250_catalogue_taxonomy
      order by department, subcategory is not null, subcategory
    `);
  }

  async productsByIds(ids: string[]): Promise<Record<string, unknown>[]> {
    const requested = productIds(ids, 100);
    const order = requested.map((_, index) => `when ? then ${index}`).join(" ");
    const rows = await allRows<D1Row>(this.database, `
      select ${PUBLIC_COLUMNS}
      from med250_catalogue_products product
      where product.id in (${inClause(requested.length)})
        and product.is_active = 1 and product.publication_status = 'approved'
      order by case product.id ${order} else ${requested.length} end
    `, [...requested, ...requested]);
    return rows.map(serializableProduct);
  }

  async imagePresentations(ids: string[]): Promise<Record<string, unknown>[]> {
    const requested = productIds(ids, 24);
    const order = requested.map((_, index) => `when ? then ${index}`).join(" ");
    return allRows(this.database, `
      select image.product_id, image.quality_score, image.source_kind
      from med250_product_images image
      join med250_catalogue_products product on product.id = image.product_id
      where image.product_id in (${inClause(requested.length)})
        and image.position = 1 and image.approved = 1 and product.is_active = 1
      order by case image.product_id ${order} else ${requested.length} end
    `, [...requested, ...requested]);
  }

  async publicMedia(productId: string, position: number): Promise<CatalogueMedia | null> {
    if (!PRODUCT_ID.test(productId) || !Number.isInteger(position) || position < 1 || position > 6) return null;
    const row = await firstRow<D1Row>(this.database, `
      select image.r2_key, image.content_sha256
      from med250_product_images image
      join med250_catalogue_products product on product.id = image.product_id
      where image.product_id = ? and image.position = ?
        and image.approved = 1 and product.is_active = 1 and product.publication_status = 'approved'
      limit 1
    `, [productId, position]);
    if (!row) return null;
    return { r2Key: stringValue(row, "r2_key"), sha256: stringValue(row, "content_sha256") };
  }
}

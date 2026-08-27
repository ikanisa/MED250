import { defineTool } from "@nekuda/webmcp-sdk";
import { searchCatalogue } from "../lib/dawanear-client";
import { requireMarketplaceRuntime } from "./marketplace-runtime";
import { publicProductSummary } from "./product-summary";

type SearchProductsInput = {
  query: string;
  category?: string;
  prescription_status?: string;
  form_group?: string;
  limit?: number;
};

const PRESCRIPTION_STATUSES = new Set(["all", "non_prescription", "prescription", "pharmacist_only", "unclassified"]);
const FORM_GROUPS = new Set(["all", "tablets", "liquids", "injections", "topical", "devices", "other"]);

function optionalFilter(value: string | undefined, allowed: Set<string>, label: string) {
  const cleaned = value?.trim() || "all";
  if (!allowed.has(cleaned)) throw new Error(`${label} is not supported by the MED+250 catalogue.`);
  return cleaned;
}

function isLocalPreview() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export const searchProducts = defineTool<SearchProductsInput>({
  stableKey: "catalogue.search",
  name: "search_products",
  title: "Search MED+250 products",
  description: "Search MED+250's public catalogue by product name, active ingredient, symptom term, category, prescription status or dosage form. Use when a visitor wants to find suitable catalogue entries. Returns approved product summaries and displays the same filtered results in the marketplace.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 160, description: "Product, ingredient or supported symptom term, up to 160 characters." },
      category: { type: "string", maxLength: 160, description: "Optional MED+250 catalogue category." },
      prescription_status: {
        type: "string",
        enum: ["all", "non_prescription", "prescription", "pharmacist_only", "unclassified"],
        description: "Optional prescription status filter.",
      },
      form_group: {
        type: "string",
        enum: ["all", "tablets", "liquids", "injections", "topical", "devices", "other"],
        description: "Optional dosage-form group.",
      },
      limit: { type: "integer", minimum: 1, maximum: 24, default: 12, description: "Maximum results to return, from 1 to 24." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  async execute({ query, category, prescription_status, form_group, limit = 12 }) {
    const cleanedQuery = query.trim();
    if (cleanedQuery.length > 160) throw new Error("Catalogue search must be no longer than 160 characters.");
    const cleanedCategory = category?.trim() || "All products";
    if (cleanedCategory.length > 160) throw new Error("Catalogue category must be no longer than 160 characters.");
    const prescriptionStatus = optionalFilter(prescription_status, PRESCRIPTION_STATUSES, "Prescription status");
    const formGroup = optionalFilter(form_group, FORM_GROUPS, "Dosage form");
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
      throw new Error("Catalogue result limit must be between 1 and 24.");
    }

    const runtime = requireMarketplaceRuntime();
    let result;
    try {
      result = await searchCatalogue({
        query: cleanedQuery,
        category: cleanedCategory,
        prescriptionStatus,
        formGroup,
        sort: "relevance",
        limit,
        offset: 0,
      });
    } catch (error) {
      if (!isLocalPreview()) throw error;
      result = runtime.searchPreview({
        query: cleanedQuery,
        category: cleanedCategory,
        prescriptionStatus,
        formGroup,
        limit,
      });
    }
    runtime.showSearch({
      query: cleanedQuery,
      category: cleanedCategory,
      prescriptionStatus,
      formGroup,
    });

    return {
      query: cleanedQuery,
      filters: { category: cleanedCategory, prescriptionStatus, formGroup },
      total: result.total,
      products: result.products.map((product) => ({
        ...publicProductSummary(product),
        matchExplanation: result.explanations.get(product.id) ?? null,
      })),
      note: result.products.length
        ? "The visible MED+250 catalogue now shows this search."
        : "MED+250 has no matching catalogue products for these filters; the visible catalogue shows the empty result.",
    };
  },
});

const PRESCRIPTION_VALUES = new Set(["all", "non_prescription", "prescription", "pharmacist_only", "unclassified"]);
const FORM_VALUES = new Set(["all", "tablets", "liquids", "injections", "topical", "devices", "other"]);
const AVAILABILITY_VALUES = new Set(["all", "priced", "orderable", "registered"]);
const SORT_VALUES = new Set(["relevance", "az", "za", "price"]);
const VIEW_VALUES = new Set(["grid", "list"]);
const MAX_CATALOGUE_QUERY_LENGTH = 160;

function boundedNavigationSearch(value: string) {
  return value.slice(0, MAX_CATALOGUE_QUERY_LENGTH);
}

export type CatalogueNavigationState = {
  search: string;
  category: string;
  prescription: string;
  form: string;
  availability: string;
  sort: string;
  view: "grid" | "list";
  shown: number;
  position: string | null;
};

export type CatalogueNavigationDefaults = {
  initialCategory: string;
  initialProductCount: number;
  maxRestoredProductCount: number;
};

function allowed(value: string | null, values: Set<string>, fallback: string) {
  const normalized = value?.trim() ?? "";
  return values.has(normalized) ? normalized : fallback;
}

export function parseCatalogueNavigationState(
  search: string,
  defaults: CatalogueNavigationDefaults,
): CatalogueNavigationState {
  const parameters = new URLSearchParams(search);
  const parsedShown = Number(parameters.get("shown") ?? defaults.initialProductCount);
  const shown = Number.isFinite(parsedShown)
    ? Math.min(
      defaults.maxRestoredProductCount,
      Math.max(defaults.initialProductCount, Math.floor(parsedShown)),
    )
    : defaults.initialProductCount;
  return {
    search: boundedNavigationSearch(parameters.get("search")?.trim() ?? ""),
    category: parameters.get("category")?.trim().slice(0, 120) || defaults.initialCategory,
    prescription: allowed(parameters.get("prescription"), PRESCRIPTION_VALUES, "all"),
    form: allowed(parameters.get("form"), FORM_VALUES, "all"),
    availability: allowed(parameters.get("availability"), AVAILABILITY_VALUES, "all"),
    sort: allowed(parameters.get("sort"), SORT_VALUES, "relevance"),
    view: allowed(parameters.get("view"), VIEW_VALUES, "grid") as "grid" | "list",
    shown,
    position: parameters.get("position")?.trim().slice(0, 160) || null,
  };
}

export function catalogueFilterStateKey(state: Pick<
  CatalogueNavigationState,
  "search" | "category" | "prescription" | "form" | "availability" | "sort" | "view"
>) {
  return [
    state.search,
    state.category,
    state.prescription,
    state.form,
    state.availability,
    state.sort,
    state.view,
  ].join("\u0000");
}

export function serializeCatalogueNavigationState(
  currentSearch: string,
  state: CatalogueNavigationState,
  defaults: Pick<CatalogueNavigationDefaults, "initialCategory" | "initialProductCount">,
) {
  const parameters = new URLSearchParams(currentSearch);
  const setOrDelete = (name: string, value: string, defaultValue: string) => {
    if (value && value !== defaultValue) parameters.set(name, value);
    else parameters.delete(name);
  };
  setOrDelete("search", state.search.trim(), "");
  setOrDelete("category", state.category, defaults.initialCategory);
  setOrDelete("prescription", state.prescription, "all");
  setOrDelete("form", state.form, "all");
  setOrDelete("availability", state.availability, "all");
  setOrDelete("sort", state.sort, "relevance");
  setOrDelete("view", state.view, "grid");
  setOrDelete("shown", String(state.shown), String(defaults.initialProductCount));
  setOrDelete("position", state.position ?? "", "");
  return parameters.toString();
}

export function withCatalogueReturnPosition(
  currentSearch: string,
  productId: string,
  shown: number,
) {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set("position", productId.trim().slice(0, 160));
  parameters.set("shown", String(Math.max(1, Math.floor(shown))));
  return parameters.toString();
}

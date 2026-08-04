export type CatalogueIntentState = {
  query: string;
  initialCategory: string;
  category: string;
  prescription: string;
  form: string;
  availability: string;
  sort: string;
  view: "grid" | "list";
};

/**
 * Returns true once the customer has expressed catalogue intent.
 * Landing-page storytelling should yield to results and controls in this state.
 */
export function isCatalogueIntentActive(state: CatalogueIntentState) {
  return Boolean(state.query.trim())
    || state.category !== state.initialCategory
    || state.prescription !== "all"
    || state.form !== "all"
    || state.availability !== "all"
    || state.sort !== "relevance"
    || state.view !== "grid";
}

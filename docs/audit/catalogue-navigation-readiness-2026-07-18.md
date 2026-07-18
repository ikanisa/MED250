# Catalogue navigation readiness — 2026-07-18

## Finding

Audit finding P2-3 requires product breadcrumbs to include category context and browser Back to restore the catalogue state a customer left.

Status: **partial**. The source and functional-test contract is implemented. Controlled desktop and mobile evidence against an immutable live release is still required.

## Implemented contract

`lib/catalogue-navigation-state.ts` is the single boundary for catalogue URL state. It:

- parses and serializes search, department/category, prescription, form, availability, sort, and grid/list controls;
- preserves loaded result depth and the selected product used for return focus;
- retains unrelated query parameters so request and campaign deep links are not erased;
- constrains search, category, product identifiers, and restored depth;
- rejects unsupported filter, sort, and view values; and
- computes result identity without treating loaded depth or focus as a filter change.

`app/marketplace.tsx` consumes this boundary during initial hydration, `popstate`, URL replacement, filter resets, and product-link navigation. After browser Back, it loads through the remembered depth, scrolls the remembered card into view, and moves keyboard focus to that card's first link.

The existing product page continues to provide visual and JSON-LD department/category breadcrumbs from the governed product taxonomy.

## Automated evidence

Run:

```sh
node --test tests/catalogue-navigation-state.test.mjs tests/rendered-html.test.mjs
```

The functional cases prove:

1. all catalogue controls, loaded depth, and focus target survive a round trip;
2. unsupported or excessive URL values fail closed while unrelated deep-link parameters remain;
3. product navigation records the selected product and current loaded depth; and
4. filter identity changes for every result control but not for loaded depth or focus.

The rendered-source integration checks prove the marketplace uses the shared state boundary and retains the focus/scroll restoration hooks.

## Remaining closure

Bind desktop and mobile captures to the exact released revision and demonstrate this sequence:

1. apply a query, department, multiple filters, non-default sort, and list view;
2. load beyond the initial result batch;
3. open a product from the later batch;
4. use browser Back; and
5. confirm the URL, controls, loaded depth, scroll position, and keyboard focus are restored.

Do not mark P2-3 complete from local tests alone.

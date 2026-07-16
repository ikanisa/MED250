import type { Product } from "./dawanear-client";

export type NonPrescriptionDepartment = {
  label: string;
  href: string;
  legacyCategory: string;
  subcategories: readonly string[];
};

export const NON_PRESCRIPTION_TAXONOMY: readonly NonPrescriptionDepartment[] = [
  {
    label: "Beauty & Personal Care",
    href: "/category/personal-care",
    legacyCategory: "Personal care",
    subcategories: [
      "Makeup",
      "Skin Care",
      "Hair Care",
      "Fragrance",
      "Foot, Hand & Nail Care",
      "Tools & Accessories",
      "Shave & Hair Removal",
      "Personal Care",
      "Oral Care",
    ],
  },
  {
    label: "Baby",
    href: "/category/baby-family",
    legacyCategory: "Baby & family",
    subcategories: [
      "Baby Care",
      "Diapering",
      "Feeding",
      "Nursery",
      "Pregnancy & Maternity",
    ],
  },
  {
    label: "Health & Household",
    href: "/category/wellness",
    legacyCategory: "Wellness",
    subcategories: [
      "Baby & Child Care",
      "Health Care",
      "Household Supplies",
      "Medical Supplies & Equipment",
      "Oral Care",
      "Personal Care",
      "Sexual Wellness",
      "Sports Nutrition",
      "Vision Care",
      "Vitamins & Dietary Supplements",
      "Wellness & Relaxation",
    ],
  },
] as const;

function taxonomyValue(department: string, subcategory: string) {
  return `${department} / ${subcategory}`;
}

export function taxonomyOptionValue(department: string, subcategory: string) {
  return taxonomyValue(department, subcategory);
}

export function taxonomyFilterDepartment(value: string) {
  return NON_PRESCRIPTION_TAXONOMY.find((department) => (
    department.label === value
    || department.subcategories.some((subcategory) => taxonomyValue(department.label, subcategory) === value)
  )) ?? null;
}

export function isNonPrescriptionTaxonomyFilter(value: string) {
  return taxonomyFilterDepartment(value) !== null;
}

export function backendCategoryFor(value: string) {
  return value;
}

type TaxonomyProduct = Pick<Product, "category" | "prescriptionStatus" | "department" | "subcategory">;

export function nonPrescriptionTaxonomyForProduct(product: TaxonomyProduct) {
  if (product.prescriptionStatus !== "non_prescription") return null;
  const directDepartment = NON_PRESCRIPTION_TAXONOMY.find((department) => (
    department.label === product.department
    || department.label === product.category
    || department.legacyCategory === product.category
    || department.subcategories.includes(product.category)
  ));
  if (!directDepartment) return null;
  // A subcategory is a data field, not a prediction from the product name.
  // If the catalogue row does not carry one, callers must not render a label.
  const subcategory = product.subcategory && directDepartment.subcategories.includes(product.subcategory)
    ? product.subcategory
    : null;
  if (!subcategory) return null;
  return {
    department: directDepartment.label,
    subcategory,
    subcategoryValue: taxonomyValue(directDepartment.label, subcategory),
  };
}

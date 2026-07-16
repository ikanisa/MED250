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

type TaxonomyProduct = Pick<Product, "brand" | "generic" | "form" | "packSize" | "category" | "prescriptionStatus" | "department" | "subcategory">;

function inferredSubcategory(department: NonPrescriptionDepartment, product: TaxonomyProduct) {
  const text = `${product.brand} ${product.generic} ${product.form} ${product.packSize} ${product.category}`.toLowerCase();
  if (department.label === "Beauty & Personal Care") {
    if (/tooth|dental|mouth|oral|floss/.test(text)) return "Oral Care";
    if (/shampoo|conditioner|hair|scalp/.test(text)) return "Hair Care";
    if (/perfume|fragrance|deodorant|cologne/.test(text)) return "Fragrance";
    if (/shav|razor|hair removal|depilator/.test(text)) return "Shave & Hair Removal";
    if (/nail|manicure|pedicure|foot|hand cream/.test(text)) return "Foot, Hand & Nail Care";
    if (/brush|comb|mirror|applicator|beauty tool/.test(text)) return "Tools & Accessories";
    if (/makeup|lipstick|mascara|foundation|cosmetic/.test(text)) return "Makeup";
    if (/skin|lotion|cream|cleanser|moisturi|sunscreen|soap/.test(text)) return "Skin Care";
    return "Personal Care";
  }
  if (department.label === "Baby") {
    if (/diaper|nappy|wipe/.test(text)) return "Diapering";
    if (/bottle|feeding|formula|weaning|breast pump/.test(text)) return "Feeding";
    if (/crib|cot|nursery|blanket|mosquito net/.test(text)) return "Nursery";
    if (/pregnan|maternity|prenatal|postnatal/.test(text)) return "Pregnancy & Maternity";
    return "Baby Care";
  }
  if (/vitamin|supplement|mineral|omega|probiotic/.test(text)) return "Vitamins & Dietary Supplements";
  if (/sport|protein|amino|electrolyte/.test(text)) return "Sports Nutrition";
  if (/eye|vision|contact lens/.test(text)) return "Vision Care";
  if (/sexual|condom|lubricant|intimate/.test(text)) return "Sexual Wellness";
  if (/tooth|dental|mouth|oral|floss/.test(text)) return "Oral Care";
  if (/baby|infant|child|pediatric/.test(text)) return "Baby & Child Care";
  if (/detergent|cleaner|disinfect|household|laundry/.test(text)) return "Household Supplies";
  if (/device|monitor|meter|thermometer|bandage|first aid|equipment/.test(text)) return "Medical Supplies & Equipment";
  if (/relax|sleep|aroma|massage/.test(text)) return "Wellness & Relaxation";
  if (/hygiene|personal care|sanitary/.test(text)) return "Personal Care";
  return "Health Care";
}

export function nonPrescriptionTaxonomyForProduct(product: TaxonomyProduct) {
  if (product.prescriptionStatus !== "non_prescription") return null;
  const directDepartment = NON_PRESCRIPTION_TAXONOMY.find((department) => (
    department.label === product.department
    || department.label === product.category
    || department.legacyCategory === product.category
    || department.subcategories.includes(product.category)
  ));
  if (!directDepartment) return null;
  const subcategory = product.subcategory && directDepartment.subcategories.includes(product.subcategory)
    ? product.subcategory
    : directDepartment.subcategories.includes(product.category)
      ? product.category
      : inferredSubcategory(directDepartment, product);
  return {
    department: directDepartment.label,
    subcategory,
    subcategoryValue: taxonomyValue(directDepartment.label, subcategory),
  };
}

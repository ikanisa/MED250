import { Cross, FileText, HeartPulse, PackageCheck, ShieldCheck, Store } from "lucide-react";
import type { Product } from "../lib/dawanear-client";
import { marketplaceMessage } from "../lib/marketplace-messages";

function prescriptionLabel(status: Product["prescriptionStatus"]) {
  if (status === "prescription") return marketplaceMessage("product.prescription_required");
  if (status === "non_prescription") return marketplaceMessage("product.no_prescription_required");
  if (status === "pharmacist_only") return marketplaceMessage("product.ask_pharmacist");
  return "";
}

export default function ProductDetailsList({ product }: { product: Product }) {
  const rows = [
    product.strength ? { label: marketplaceMessage("inventory.63ee3a1b965a"), value: product.strength, icon: HeartPulse } : null,
    product.form ? { label: marketplaceMessage("inventory.2e0e960ab320"), value: product.form, icon: Cross } : null,
    product.packSize ? { label: marketplaceMessage("inventory.80dc21673e55"), value: product.packSize, icon: PackageCheck } : null,
    product.manufacturer || product.manufacturerCountry ? { label: marketplaceMessage("inventory.1af384c577f2"), value: [product.manufacturer, product.manufacturerCountry].filter(Boolean).join(" · "), icon: Store } : null,
    product.registrationNumber ? { label: marketplaceMessage("inventory.5546bafd5ec8"), value: product.registrationNumber, icon: ShieldCheck } : null,
    prescriptionLabel(product.prescriptionStatus) ? { label: marketplaceMessage("inventory.9bc867e65b8f"), value: prescriptionLabel(product.prescriptionStatus), icon: FileText } : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) return null;
  return <dl className="product-specification-list">
    {rows.map((row) => {
      const Icon = row.icon;
      return <div key={row.label}><Icon size={19} aria-hidden="true" /><dt>{row.label}</dt><dd>{row.value}</dd></div>;
    })}
  </dl>;
}

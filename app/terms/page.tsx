import type { Metadata } from "next";
import InfoShell from "../info-shell";
import { marketplaceAlternates } from "../../lib/marketplace-locale";
import { marketplaceMessage } from "../../lib/marketplace-messages";

export const metadata: Metadata = {
  title: marketplaceMessage("inventory.65e6e65cd7eb"),
  description: marketplaceMessage("inventory.c1a97dfc46f0"),
  alternates: marketplaceAlternates("/terms"),
};

export default function TermsPage() {
  return (
    <InfoShell
      eyebrow={marketplaceMessage("inventory.e8ad9185f4ad")}
      title={marketplaceMessage("inventory.a2b32346bc87")}
      intro={marketplaceMessage("inventory.278f7a990bdc")}
    >
      <section><h2>{marketplaceMessage("inventory.34fdfeb1a74f")}</h2><p>{marketplaceMessage("inventory.bab154b09440")}</p></section>
      <section><h2>{marketplaceMessage("inventory.0c9735eb46ff")}</h2><p>{marketplaceMessage("inventory.d1e31ba567c1")}</p></section>
      <section><h2>{marketplaceMessage("inventory.abb6a0114714")}</h2><p>{marketplaceMessage("inventory.aa0f09787efd")}</p></section>
      <section><h2>{marketplaceMessage("inventory.035dadf132d1")}</h2><p>{marketplaceMessage("inventory.135e5dcfa13a")}</p></section>
      <section><h2>{marketplaceMessage("inventory.632e1c583941")}</h2><p>{marketplaceMessage("inventory.8051138b54d4")}</p></section>
    </InfoShell>
  );
}

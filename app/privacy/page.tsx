import type { Metadata } from "next";
import InfoShell from "../info-shell";
import { marketplaceAlternates } from "../../lib/marketplace-locale";
import { marketplaceMessage } from "../../lib/marketplace-messages";

export const metadata: Metadata = {
  title: marketplaceMessage("navigation.privacy"),
  description: marketplaceMessage("inventory.9c1e99af0efd"),
  alternates: marketplaceAlternates("/privacy"),
};

export default function PrivacyPage() {
  return (
    <InfoShell
      eyebrow={marketplaceMessage("inventory.39d98d5b9cd5")}
      title={marketplaceMessage("inventory.eb86f860c44f")}
      intro={marketplaceMessage("inventory.d9302d510d99")}
    >
      <section><h2>{marketplaceMessage("inventory.f1bcd650fb8d")}</h2><p>{marketplaceMessage("inventory.0f91ad22b6e6")}</p></section>
      <section><h2>{marketplaceMessage("inventory.ef4903cec8c5")}</h2><p>{marketplaceMessage("inventory.b610143dd4e0")}</p></section>
      <section><h2>{marketplaceMessage("inventory.ac8d2d623440")}</h2><p>{marketplaceMessage("inventory.3ae751db9645")}</p></section>
      <section><h2>{marketplaceMessage("inventory.ad2ded1604fd")}</h2><p>{marketplaceMessage("inventory.bba907c266ce")}</p></section>
      <section><h2>{marketplaceMessage("inventory.764e1f17bc8b")}</h2><p>{marketplaceMessage("inventory.b2547a8aa861")}</p></section>
    </InfoShell>
  );
}

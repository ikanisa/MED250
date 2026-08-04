import { CircleCheck, MapPin, MessageCircle, PackageCheck, ShieldCheck } from "lucide-react";
import { marketplaceDate, marketplaceNumber } from "../lib/marketplace-locale";
import { marketplaceFormatMessage, marketplaceMessage } from "../lib/marketplace-messages";
import type { PublicTrustMetrics } from "../lib/public-trust-metrics";

export default function ProductRequestExpectations({
  hasIndicativePrice,
  trustMetrics,
}: {
  hasIndicativePrice: boolean;
  trustMetrics: PublicTrustMetrics | null;
}) {
  const readyPharmacyCount = trustMetrics?.readyPharmacyCount;
  const typicalResponse = trustMetrics?.typicalResponse;
  return <aside className="product-request-expectations" aria-labelledby="product-request-expectations-title">
    <div className="product-request-expectations-heading">
      <span><ShieldCheck size={19} aria-hidden="true" /></span>
      <div><h2 id="product-request-expectations-title">{marketplaceMessage("product.request_expectations_title")}</h2><p>{marketplaceMessage("product.request_expectations_body")}</p></div>
    </div>
    <ul>
      <li><MapPin size={17} aria-hidden="true" /><span>{marketplaceMessage("product.request_dispatch")}</span></li>
      <li><CircleCheck size={17} aria-hidden="true" /><span>{marketplaceMessage(hasIndicativePrice ? "product.request_price_indicative" : "product.request_price_confirmed")}</span></li>
      <li><PackageCheck size={17} aria-hidden="true" /><span>{marketplaceMessage("product.request_fulfilment")}</span></li>
      <li><MessageCircle size={17} aria-hidden="true" /><span>{marketplaceMessage("product.request_whatsapp_privacy")}</span></li>
    </ul>
    {readyPharmacyCount || typicalResponse ? <div className="product-request-evidence" aria-label={marketplaceMessage("inventory.1362e2a3afc4")}>
      {readyPharmacyCount ? <span><b>{marketplaceFormatMessage("inventory.1d9a32f87023", [marketplaceNumber(readyPharmacyCount.value), readyPharmacyCount.value === 1 ? marketplaceMessage("inventory.20b04a4f018b") : marketplaceMessage("inventory.13ab5da0df2b")])}</b><small>{marketplaceFormatMessage("inventory.b6e45056d7d3", [marketplaceNumber(readyPharmacyCount.sampleSize), marketplaceDate(readyPharmacyCount.asOf)])}</small></span> : null}
      {typicalResponse ? <span><b>{marketplaceFormatMessage("inventory.2826eec6f95e", [typicalResponse.valueMinutes, typicalResponse.valueMinutes === 1 ? marketplaceMessage("inventory.28cdd20eaf13") : marketplaceMessage("inventory.90e63d85fa1a")])}</b><small>{marketplaceFormatMessage("inventory.a0c2f3048f79", [marketplaceNumber(typicalResponse.sampleSize), typicalResponse.windowDays, marketplaceDate(typicalResponse.latestObservationAt)])}</small></span> : null}
    </div> : null}
  </aside>;
}

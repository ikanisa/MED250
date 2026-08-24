import Marketplace from "./marketplace";
import { getInitialMarketplaceProducts } from "../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../lib/public-marketplace-product";
import { getPublicTrustMetrics } from "../lib/public-trust-metrics";

export default async function Home() {
  const [initialTaxonomy, initialTrustMetrics] = await Promise.all([
    getPublicCatalogueTaxonomy(),
    getPublicTrustMetrics(),
  ]);
  return <Marketplace initialProducts={getInitialMarketplaceProducts()} initialTaxonomy={initialTaxonomy} initialTrustMetrics={initialTrustMetrics} />;
}

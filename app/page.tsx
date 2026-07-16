import Marketplace from "./marketplace";
import { getInitialMarketplaceProducts } from "../lib/product-seo";
import { getPublicCatalogueTaxonomy } from "../lib/public-marketplace-product";

export default async function Home() {
  const initialTaxonomy = await getPublicCatalogueTaxonomy();
  return <Marketplace initialProducts={getInitialMarketplaceProducts()} initialTaxonomy={initialTaxonomy} />;
}

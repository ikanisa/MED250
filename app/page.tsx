import Marketplace from "./marketplace";
import { getInitialMarketplaceProducts } from "../lib/product-seo";

export default function Home() {
  return <Marketplace initialProducts={getInitialMarketplaceProducts()} />;
}

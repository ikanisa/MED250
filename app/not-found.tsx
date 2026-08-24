import Link from "next/link";
import BrandLogo from "./brand-logo";
import { marketplaceMessage } from "../lib/marketplace-messages";

export default function NotFound() {
  return <main className="state-page"><Link className="brand" href="/" aria-label={marketplaceMessage("inventory.487d6543eeb5")}><BrandLogo /></Link><div><span>404</span><h1>{marketplaceMessage("error.not_found_title")}</h1><p>{marketplaceMessage("error.not_found_body")}</p><div><Link href="/categories">{marketplaceMessage("common.browse_products")}</Link><Link href="/">{marketplaceMessage("common.return_home")}</Link></div></div></main>;
}

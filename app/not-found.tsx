import Link from "next/link";
import BrandLogo from "./brand-logo";

export default function NotFound() {
  return <main className="state-page"><Link className="brand" href="/" aria-label="MED+250 home"><BrandLogo /></Link><div><span>404</span><h1>This page is not available</h1><p>The product or page may have moved. Search the current product catalogue or return to the marketplace.</p><div><Link href="/categories">Browse products</Link><Link href="/">Return home</Link></div></div></main>;
}

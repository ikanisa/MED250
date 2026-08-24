"use client";

import { useEffect } from "react";
import Link from "next/link";
import { DEFAULT_MARKETPLACE_LOCALE } from "../lib/marketplace-locale";
import { marketplaceMessage } from "../lib/marketplace-messages";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <html lang={DEFAULT_MARKETPLACE_LOCALE}><body><main className="state-page" role="alert"><div><span>{marketplaceMessage("inventory.89663747d7bc")}</span><h1>{marketplaceMessage("error.global_title")}</h1><p>{marketplaceMessage("error.global_body")}</p><div><button type="button" onClick={reset}>{marketplaceMessage("common.try_again")}</button><Link href="/">{marketplaceMessage("common.return_home")}</Link></div></div></main></body></html>;
}

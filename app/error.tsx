"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { marketplaceMessage } from "../lib/marketplace-messages";

const TRANSIENT_ERROR_PATTERN = /connection.+(?:closed|lost)|failed to fetch|network(?:error| request failed)|load failed/i;
const TRANSIENT_RETRY_KEY = "med250-transient-retry-at";
const TRANSIENT_RETRY_COOLDOWN_MS = 5_000;

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const transient = TRANSIENT_ERROR_PATTERN.test(error.message);
  const [retrying, setRetrying] = useState(transient);
  const retryScheduled = useRef(false);

  useEffect(() => {
    console.error(error);
    if (!transient || retryScheduled.current) return undefined;
    retryScheduled.current = true;
    let lastRetry = 0;
    try { lastRetry = Number(window.sessionStorage.getItem(TRANSIENT_RETRY_KEY) ?? "0"); } catch { /* restricted storage */ }
    if (Date.now() - lastRetry < TRANSIENT_RETRY_COOLDOWN_MS) {
      setRetrying(false);
      return undefined;
    }
    try { window.sessionStorage.setItem(TRANSIENT_RETRY_KEY, String(Date.now())); } catch { /* restricted storage */ }
    const timeout = window.setTimeout(reset, 320);
    return () => window.clearTimeout(timeout);
  }, [error, reset, transient]);

  if (retrying) return <main className="state-page state-loading" role="status" aria-live="polite" aria-busy="true"><div><span>{marketplaceMessage("inventory.89663747d7bc")}</span><h1>{marketplaceMessage("error.reconnecting_title")}</h1><p>{marketplaceMessage("error.reconnecting_body")}</p><i aria-hidden="true" /></div></main>;
  return <main className="state-page" role="alert"><div><span>{marketplaceMessage("inventory.89663747d7bc")}</span><h1>{marketplaceMessage("error.marketplace_title")}</h1><p>{marketplaceMessage("error.marketplace_body")}</p><div><button onClick={reset}>{marketplaceMessage("common.try_again")}</button><Link href="/categories">{marketplaceMessage("common.browse_products")}</Link></div></div></main>;
}

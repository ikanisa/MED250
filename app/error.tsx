"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="state-page" role="alert"><div><span>MED+250</span><h1>The marketplace could not load</h1><p>Nothing has been ordered. Try loading this page again, or return to the product catalogue.</p><div><button onClick={reset}>Try again</button><Link href="/categories">Browse products</Link></div></div></main>;
}

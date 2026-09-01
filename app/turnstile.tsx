"use client";

import { useEffect, useRef, useState } from "react";
import { marketplaceMessage } from "../lib/marketplace-messages";

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "med250-turnstile-api";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function Turnstile({
  siteKey,
  action = "customer_order",
  expiredMessage = "The security check expired. Complete it again before placing your order.",
  errorMessage = "The security check could not load. Check your connection and try again.",
  onToken,
  onError,
}: {
  siteKey: string;
  action?: string;
  expiredMessage?: string;
  errorMessage?: string;
  onToken(token: string): void;
  onError(message: string): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  }, [onError, onToken]);

  useEffect(() => {
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetRef.current) return;
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "auto",
        size: "flexible",
        retry: "auto",
        "retry-interval": 8000,
        callback: (token: string) => {
          setLoading(false);
          onTokenRef.current(token);
        },
        "expired-callback": () => {
          onTokenRef.current("");
          onErrorRef.current(expiredMessage);
        },
        "error-callback": () => {
          setLoading(false);
          onTokenRef.current("");
          onErrorRef.current(errorMessage);
        },
      });
      setLoading(false);
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (window.turnstile) {
      renderWidget();
    } else if (existing) {
      existing.addEventListener("load", renderWidget, { once: true });
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", renderWidget, { once: true });
      script.addEventListener("error", () => {
        if (!cancelled) {
          setLoading(false);
          onErrorRef.current(errorMessage);
        }
      }, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      existing?.removeEventListener("load", renderWidget);
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [action, errorMessage, expiredMessage, siteKey]);

  return <div className="turnstile-check" aria-label={marketplaceMessage("inventory.147bf977ab0a")}>
    <div ref={containerRef} />
    {loading ? <small role="status">{marketplaceMessage("inventory.b5133c200e17")}</small> : null}
  </div>;
}

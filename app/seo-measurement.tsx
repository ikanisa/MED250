"use client";

import { useEffect } from "react";
import { trackMarketplaceEvent } from "../lib/marketplace-observability";

function landingType(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/product/")) return "product";
  if (pathname === "/categories" || pathname.startsWith("/category/")) return "category";
  if (["/about", "/how-it-works", "/trust", "/contact"].includes(pathname)) return "trust";
  if (pathname === "/find-medicine") return "intent";
  return "other";
}

function acquisitionChannel(url: URL) {
  const medium = (url.searchParams.get("utm_medium") ?? "").toLowerCase();
  if (["cpc", "ppc", "paid", "paidsearch"].includes(medium)) return "paid_search";
  if (["social", "paid_social"].includes(medium)) return "social";
  if (!document.referrer) return "direct_or_unknown";
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === url.origin) return "internal";
    if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia)\./i.test(referrer.hostname)) return "organic_search";
    if (/(^|\.)(facebook|instagram|linkedin|tiktok|x|twitter)\./i.test(referrer.hostname)) return "social";
    return "referral";
  } catch {
    return "direct_or_unknown";
  }
}

function deviceClass() {
  const agent = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|kindle/.test(agent)) return "tablet";
  if (/mobile|iphone|android/.test(agent)) return "mobile";
  return "desktop";
}

export default function SeoMeasurement() {
  useEffect(() => {
    const url = new URL(window.location.href);
    trackMarketplaceEvent("seo_landing", {
      channel: acquisitionChannel(url),
      landingType: landingType(url.pathname),
      device: deviceClass(),
    });
  }, []);
  return null;
}

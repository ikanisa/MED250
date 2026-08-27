(() => {
  const script = document.currentScript;
  if (!script || script.dataset.cloud !== "1") return;
  const url = new URL(location.href);
  const path = url.pathname;
  const medium = (url.searchParams.get("utm_medium") || "").toLowerCase();
  let channel = "direct_or_unknown";
  if (["cpc", "ppc", "paid", "paidsearch"].includes(medium)) channel = "paid_search";
  else if (["social", "paid_social"].includes(medium)) channel = "social";
  else if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      channel = referrer.origin === url.origin ? "internal"
        : /(^|\.)(google|bing|yahoo|duckduckgo|ecosia)\./i.test(referrer.hostname) ? "organic_search"
          : /(^|\.)(facebook|instagram|linkedin|tiktok|x|twitter)\./i.test(referrer.hostname) ? "social" : "referral";
    } catch {}
  }
  const landingType = path === "/" ? "home"
    : path.startsWith("/product/") ? "product"
      : path === "/categories" || path.startsWith("/category/") ? "category"
        : ["/about", "/trust", "/contact"].includes(path) ? "trust"
          : path === "/find-medicine" ? "intent" : "other";
  const agent = navigator.userAgent.toLowerCase();
  const device = /ipad|tablet|kindle/.test(agent) ? "tablet" : /mobile|iphone|android/.test(agent) ? "mobile" : "desktop";
  fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "seo_landing", properties: { channel, landingType, device } }),
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
})();

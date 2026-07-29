const legacyHostname = "med250.gikundiro.com";
const canonicalOrigin = "https://med-250.com";

export function buildLegacyRedirect(request) {
  const incoming = new URL(request.url);

  if (incoming.hostname !== legacyHostname) {
    return new Response("Misdirected request", {
      status: 421,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  const destination = new URL(`${incoming.pathname}${incoming.search}`, canonicalOrigin);
  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=300",
      Location: destination.href,
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

const legacyRedirectWorker = {
  fetch(request) {
    return buildLegacyRedirect(request);
  },
};

export default legacyRedirectWorker;

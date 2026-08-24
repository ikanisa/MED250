import { PayloadTooLargeError, readBodyText } from "./bounded-body.ts";
import { sha256Hex, verifyClientLocationToken } from "./secure-token.ts";
import type { WhatsAppRepository } from "./whatsapp-repository.ts";

type LocationPayload = {
  token: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
};

function page(token: string): string {
  const encodedToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="en-RW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Share delivery location | MED+250</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17203b;background:#f5f7ff}
    body{margin:0;padding:24px;min-height:100vh;box-sizing:border-box;display:grid;place-items:center}
    main{width:min(100%,560px);background:#fff;border:1px solid #dfe4f3;border-radius:20px;padding:24px;box-shadow:0 16px 48px rgba(35,48,91,.12)}
    h1{font-size:1.45rem;margin:.25rem 0 .7rem}p{line-height:1.55;color:#4b5575}button{width:100%;border:0;border-radius:12px;padding:14px 18px;font:inherit;font-weight:750;background:#3157d5;color:#fff;cursor:pointer;margin-top:12px}button[disabled]{opacity:.6;cursor:wait}.secondary{background:#eef2ff;color:#2646a5}iframe{width:100%;height:250px;border:0;border-radius:12px;margin-top:16px;display:none}.notice{font-size:.88rem;background:#f1f4fd;border-radius:10px;padding:12px}.status{min-height:1.5em;font-weight:650;color:#2945a4}#confirm{display:none}
  </style>
</head>
<body>
  <main>
    <small>MED+250 secure location</small>
    <h1>Confirm where pharmacies should serve you</h1>
    <p class="notice">Your location and client-supplied medicine or prescription image will be used only to assign up to 10 verified nearby pharmacies. Those pharmacies also receive your WhatsApp number so they can respond directly.</p>
    <p id="status" class="status" role="status" aria-live="polite">Your location has not been shared yet.</p>
    <button id="locate" type="button">Show my current location</button>
    <iframe id="map" title="Preview of your selected location" referrerpolicy="no-referrer"></iframe>
    <button id="confirm" type="button">Confirm and dispatch request</button>
  </main>
  <script>
    const token=${encodedToken};let selected=null;
    const status=document.getElementById("status"),locate=document.getElementById("locate"),confirm=document.getElementById("confirm"),map=document.getElementById("map");
    locate.addEventListener("click",()=>{if(!navigator.geolocation){status.textContent="Location sharing is unavailable on this device.";return}locate.disabled=true;status.textContent="Finding your location…";navigator.geolocation.getCurrentPosition((position)=>{const latitude=position.coords.latitude,longitude=position.coords.longitude;selected={latitude,longitude,accuracyM:Number.isFinite(position.coords.accuracy)?position.coords.accuracy:null};const delta=.008;const box=[longitude-delta,latitude-delta,longitude+delta,latitude+delta].join(",");map.src="https://www.openstreetmap.org/export/embed.html?bbox="+encodeURIComponent(box)+"&marker="+encodeURIComponent(latitude+","+longitude);map.style.display="block";confirm.style.display="block";status.textContent="Review the map, then confirm to save and dispatch.";locate.disabled=false;locate.textContent="Refresh location"},()=>{status.textContent="We could not access your location. Allow location access and try again.";locate.disabled=false},{enableHighAccuracy:true,timeout:20000,maximumAge:0})});
    confirm.addEventListener("click",async()=>{if(!selected)return;confirm.disabled=true;locate.disabled=true;status.textContent="Saving and assigning nearby pharmacies…";try{const response=await fetch("/api/whatsapp/location",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,...selected}),credentials:"omit",referrerPolicy:"no-referrer"});const receipt=await response.json();if(!response.ok)throw new Error(receipt.error||"location_failed");status.textContent=receipt.recipientCount>0?"Location saved. Your request was assigned to "+receipt.recipientCount+" nearby verified pharmacies. You may close this page.":"Location saved. No verified pharmacy could be assigned yet; your image was not shared. You may close this page.";confirm.style.display="none";locate.style.display="none"}catch{status.textContent="We could not save the location. Please return to WhatsApp and try again.";confirm.disabled=false;locate.disabled=false}});
  </script>
</body>
</html>`;
}

function parsedLocation(body: string): LocationPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("invalid_payload");
  const token: unknown = Reflect.get(parsed, "token");
  const latitude: unknown = Reflect.get(parsed, "latitude");
  const longitude: unknown = Reflect.get(parsed, "longitude");
  const accuracy: unknown = Reflect.get(parsed, "accuracyM");
  if (
    typeof token !== "string"
    || typeof latitude !== "number"
    || typeof longitude !== "number"
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -3.0
    || latitude > -0.8
    || longitude < 28.7
    || longitude > 30.9
  ) throw new Error("invalid_location");
  const accuracyM = accuracy === null || accuracy === undefined ? null : Number(accuracy);
  if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > 5_000)) {
    throw new Error("invalid_accuracy");
  }
  return { token, latitude, longitude, accuracyM };
}

export async function locationPageResponse(
  request: Request,
  repository: WhatsAppRepository | null,
  linkSecret: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/whatsapp/location") {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    }
    const token = url.searchParams.get("token") ?? "";
    const claims = await verifyClientLocationToken(token, linkSecret);
    if (!claims) return new Response("This location link is invalid or expired.", { status: 410, headers: { "Cache-Control": "no-store" } });
    return new Response(page(token), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  if (url.pathname !== "/api/whatsapp/location") return null;
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  try {
    if (!repository) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return Response.json({ error: "unsupported_content_type" }, { status: 415 });
    const input = parsedLocation(await readBodyText(request, 32 * 1024));
    const claims = await verifyClientLocationToken(input.token, linkSecret);
    if (!claims) return Response.json({ error: "invalid_or_expired_token" }, { status: 410 });
    const captureKeyHex = await sha256Hex(`secure-webview:${claims.nonce}`);
    const receipt = await repository.saveLocation({
      actorId: claims.actorId,
      requestId: claims.requestId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM: input.accuracyM,
      address: null,
      label: "WhatsApp shared location",
      source: "secure_webview",
      captureKeyHex,
      eventId: null,
    });
    return Response.json(
      { saved: true, recipientCount: receipt.recipientCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof PayloadTooLargeError ? 413 : 400;
    return Response.json({ error: status === 413 ? "payload_too_large" : "invalid_location" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

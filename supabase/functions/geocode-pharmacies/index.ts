import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function secretMatches(received: string, expected: string) {
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function elevatedSupabaseKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const values = Object.values(parsed);
      if (values[0]) return values[0];
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const adminSecret = Deno.env.get("DAWANEAR_ADMIN_TOKEN");
  const suppliedSecret = request.headers.get("X-DawaNear-Admin-Token") ?? "";
  if (!adminSecret || !secretMatches(suppliedSecret, adminSecret)) {
    return new Response("Forbidden", { status: 403 });
  }
  const serviceKey = elevatedSupabaseKey();
  if (!serviceKey) return new Response("Supabase elevated key is not configured", { status: 503 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!googleKey) return new Response("GOOGLE_MAPS_API_KEY is not configured", { status: 503 });

  const body = await request.json();
  const batchLimit = Math.min(Math.max(Number(body.batch_limit || 1), 1), 25);
  let query = supabase.from("dawanear_pharmacies").select("*");
  query = body.pharmacy_id ? query.eq("id", body.pharmacy_id) : query.in("geocode_status", ["pending", "candidate"]).order("fda_source_serial").limit(batchLimit);
  const { data: pharmacies, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!pharmacies?.length) return Response.json({ processed: 0, results: [] });

  const results = [];
  for (const pharmacy of pharmacies) {
    const textQuery = [pharmacy.name, pharmacy.sector_cell_raw, pharmacy.district, pharmacy.province, "Rwanda"].filter(Boolean).join(", ");
    const mapsResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri" },
      body: JSON.stringify({ textQuery, includedType: "pharmacy", languageCode: "en", regionCode: "RW", maxResultCount: 5, locationBias: { circle: { center: { latitude: -1.9403, longitude: 29.8739 }, radius: 250000 } } }),
    });
    if (!mapsResponse.ok) {
      results.push({ pharmacy_id: pharmacy.id, status: "google_error", http_status: mapsResponse.status });
      continue;
    }
    const payload = await mapsResponse.json();
    const candidates = payload.places || [];
    const normalizedA = pharmacy.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(pharmacy|pharmacie|ltd|limited)/g, "");
    const ranked = candidates.map((candidate: Record<string, unknown>) => {
      const displayName = (candidate.displayName as { text?: string })?.text || "";
      const normalizedB = displayName.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(pharmacy|pharmacie|ltd|limited)/g, "");
      const nameScore = normalizedA === normalizedB ? 1 : normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA) ? .86 : .55;
      const locality = `${candidate.formattedAddress || ""}`.toLowerCase();
      const localityScore = [pharmacy.district, pharmacy.sector_cell_raw].filter(Boolean).some((value) => locality.includes(String(value).split(" ")[0].toLowerCase())) ? .1 : 0;
      return { candidate, confidence: Math.min(nameScore + localityScore, 1) };
    }).sort((a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence);
    const best = ranked[0];
    if (!best) {
      await supabase.from("dawanear_pharmacies").update({ geocode_status: "rejected", geocode_checked_at: new Date().toISOString() }).eq("id", pharmacy.id);
      results.push({ pharmacy_id: pharmacy.id, status: "no_match" });
      continue;
    }
    const candidate = best.candidate as { id: string; googleMapsUri?: string; formattedAddress?: string; location: { latitude: number; longitude: number } };
    const inRwanda = candidate.location.latitude >= -3 && candidate.location.latitude <= -.8
      && candidate.location.longitude >= 28.7 && candidate.location.longitude <= 30.9;
    const canVerify = body.approve === true && body.pharmacy_id === pharmacy.id && best.confidence >= .8 && inRwanda;
    const update = {
      google_place_id: candidate.id,
      google_maps_url: candidate.googleMapsUri,
      google_formatted_address: candidate.formattedAddress,
      location: `POINT(${candidate.location.longitude} ${candidate.location.latitude})`,
      location_confidence: best.confidence,
      geocode_status: canVerify ? "verified" : inRwanda ? "candidate" : "rejected",
      geocode_checked_at: new Date().toISOString(),
    };
    const { error: updateError } = await supabase.from("dawanear_pharmacies").update(update).eq("id", pharmacy.id);
    results.push(updateError ? { pharmacy_id: pharmacy.id, status: "update_error", error: updateError.message } : { pharmacy_id: pharmacy.id, status: update.geocode_status, confidence: best.confidence, google_place_id: candidate.id });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return Response.json({ processed: results.length, approved: results.filter((result) => result.status === "verified").length, results });
});

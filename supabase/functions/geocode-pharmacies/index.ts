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
  let body: Record<string, unknown>;
  try {
    const parsedBody = await request.json();
    if (!parsedBody || Array.isArray(parsedBody) || typeof parsedBody !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const action = body.approve === true ? "approve" : body.action ?? "generate";
  if (!new Set(["generate", "inspect", "approve"]).has(String(action))) {
    return Response.json({ error: "Action must be generate, inspect, or approve." }, { status: 400 });
  }
  const pharmacyId = typeof body.pharmacy_id === "string" ? body.pharmacy_id.trim() : "";
  if (body.pharmacy_id !== undefined && !pharmacyId) {
    return Response.json({ error: "pharmacy_id must be a non-empty string." }, { status: 400 });
  }
  if ((action === "inspect" || action === "approve") && !pharmacyId) {
    return Response.json({ error: `${action} requires exactly one pharmacy_id.` }, { status: 400 });
  }
  const batchLimit = Number(body.batch_limit ?? 1);
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 25) {
    return Response.json({ error: "batch_limit must be an integer from 1 to 25." }, { status: 400 });
  }
  let query = supabase.from("dawanear_pharmacies").select("*");
  query = pharmacyId ? query.eq("id", pharmacyId) : query.in("geocode_status", ["pending", "candidate"]).order("fda_source_serial").limit(batchLimit);
  const { data: pharmacies, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!pharmacies?.length && pharmacyId) return Response.json({ error: "Pharmacy record was not found." }, { status: 404 });
  if (!pharmacies?.length) return Response.json({ processed: 0, results: [] });

  if (action === "inspect") {
    if (pharmacies.length !== 1) {
      return Response.json({ error: "Inspect requires exactly one pharmacy_id." }, { status: 400 });
    }
    const pharmacy = pharmacies[0];
    if (pharmacy.geocode_status !== "candidate" || !pharmacy.google_place_id) {
      return Response.json({ error: "This pharmacy does not have a staged candidate to review." }, { status: 409 });
    }
    return Response.json({
      processed: 1,
      candidate: {
        pharmacy_id: pharmacy.id,
        pharmacy_name: pharmacy.name,
        source_serial: pharmacy.fda_source_serial,
        source_location: pharmacy.sector_cell_raw,
        district: pharmacy.district,
        province: pharmacy.province,
        google_place_id: pharmacy.google_place_id,
        google_formatted_address: pharmacy.google_formatted_address,
        google_maps_url: pharmacy.google_maps_url,
        confidence: pharmacy.location_confidence,
        checked_at: pharmacy.geocode_checked_at,
        candidate_version: pharmacy.updated_at,
      },
    });
  }

  if (action === "approve") {
    if (pharmacies.length !== 1) {
      return Response.json({ error: "Approval requires exactly one pharmacy_id." }, { status: 400 });
    }
    const placeId = typeof body.google_place_id === "string" ? body.google_place_id.trim() : "";
    const reviewedBy = typeof body.reviewed_by === "string" ? body.reviewed_by.trim() : "";
    const reviewNote = typeof body.review_note === "string" ? body.review_note.trim() : "";
    if (!placeId || reviewedBy.length < 3 || reviewedBy.length > 200 || reviewNote.length < 10 || reviewNote.length > 2000) {
      return Response.json({ error: "Approval requires the exact Google Place ID, reviewer identity, and a 10-2000 character evidence note." }, { status: 400 });
    }
    const pharmacy = pharmacies[0];
    const stagedCandidateIsEligible = pharmacy.geocode_status === "candidate"
      && pharmacy.google_place_id === placeId
      && pharmacy.location
      && Number(pharmacy.location_confidence || 0) >= .8;
    if (!stagedCandidateIsEligible) {
      return Response.json({ error: "The requested Google Place ID is not the current eligible staged candidate. Generate and review a candidate first." }, { status: 409 });
    }
    const { data: approvedRows, error: approvalError } = await supabase.rpc("dawanear_approve_geocode_candidate", {
      p_pharmacy_id: pharmacy.id,
      p_google_place_id: placeId,
      p_expected_updated_at: pharmacy.updated_at,
      p_reviewed_by: reviewedBy,
      p_review_note: reviewNote,
    });
    const approvedPharmacy = Array.isArray(approvedRows) ? approvedRows[0] : null;
    if (approvalError) return Response.json({ error: approvalError.message }, { status: 500 });
    if (!approvedPharmacy) return Response.json({ error: "The staged candidate changed before approval. Reload and review it again." }, { status: 409 });
    return Response.json({ processed: 1, approved: 1, results: [{ pharmacy_id: pharmacy.id, status: "verified", google_place_id: placeId, reviewed_at: approvedPharmacy.reviewed_at }] });
  }

  const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!googleKey) return new Response("GOOGLE_MAPS_API_KEY is not configured", { status: 503 });

  const results = [];
  for (const pharmacy of pharmacies) {
    if (pharmacy.geocode_status === "verified") {
      results.push({ pharmacy_id: pharmacy.id, status: "already_verified", error: "Verified coordinates cannot be overwritten by candidate generation." });
      continue;
    }
    const textQuery = [pharmacy.name, pharmacy.sector_cell_raw, pharmacy.district, pharmacy.province, "Rwanda"].filter(Boolean).join(", ");
    const mapsResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri" },
      body: JSON.stringify({ textQuery, includedType: "pharmacy", strictTypeFiltering: true, languageCode: "en", regionCode: "RW", maxResultCount: 5, locationBias: { circle: { center: { latitude: -1.9403, longitude: 29.8739 }, radius: 250000 } } }),
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
      const { data: clearedPharmacy, error: clearError } = await supabase.from("dawanear_pharmacies").update({
        google_place_id: null,
        google_maps_url: null,
        google_formatted_address: null,
        location: null,
        location_confidence: null,
        geocode_status: "rejected",
        geocode_checked_at: new Date().toISOString(),
        geocode_review_place_id: null,
        geocode_reviewed_by: null,
        geocode_reviewed_at: null,
        geocode_review_note: null,
      }).eq("id", pharmacy.id).eq("geocode_status", pharmacy.geocode_status).select("id").maybeSingle();
      results.push(
        clearError
          ? { pharmacy_id: pharmacy.id, status: "update_error", error: clearError.message }
          : !clearedPharmacy
            ? { pharmacy_id: pharmacy.id, status: "stale_candidate", error: "The pharmacy geocode state changed while Google Places was being checked." }
            : { pharmacy_id: pharmacy.id, status: "no_match" },
      );
      continue;
    }
    const candidate = best.candidate as { id: string; googleMapsUri?: string; formattedAddress?: string; location: { latitude: number; longitude: number } };
    const inRwanda = candidate.location.latitude >= -3 && candidate.location.latitude <= -.8
      && candidate.location.longitude >= 28.7 && candidate.location.longitude <= 30.9;
    const update = {
      google_place_id: candidate.id,
      google_maps_url: candidate.googleMapsUri,
      google_formatted_address: candidate.formattedAddress,
      location: `POINT(${candidate.location.longitude} ${candidate.location.latitude})`,
      location_confidence: best.confidence,
      geocode_status: inRwanda ? "candidate" : "rejected",
      geocode_checked_at: new Date().toISOString(),
      geocode_review_place_id: null,
      geocode_reviewed_by: null,
      geocode_reviewed_at: null,
      geocode_review_note: null,
    };
    const { data: stagedPharmacy, error: updateError } = await supabase.from("dawanear_pharmacies")
      .update(update)
      .eq("id", pharmacy.id)
      .eq("geocode_status", pharmacy.geocode_status)
      .select("id")
      .maybeSingle();
    results.push(
      updateError
        ? { pharmacy_id: pharmacy.id, status: "update_error", error: updateError.message }
        : !stagedPharmacy
          ? { pharmacy_id: pharmacy.id, status: "stale_candidate", error: "The pharmacy geocode state changed while Google Places was being checked." }
          : {
            pharmacy_id: pharmacy.id,
            pharmacy_name: pharmacy.name,
            source_serial: pharmacy.fda_source_serial,
            source_location: pharmacy.sector_cell_raw,
            district: pharmacy.district,
            province: pharmacy.province,
            status: update.geocode_status,
            confidence: best.confidence,
            google_place_id: candidate.id,
            google_formatted_address: candidate.formattedAddress,
            google_maps_url: candidate.googleMapsUri,
          },
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return Response.json({ processed: results.length, approved: results.filter((result) => result.status === "verified").length, results });
});

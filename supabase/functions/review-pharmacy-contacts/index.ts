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

const reviewSelect = `
  id, pharmacy_id, contact_id, requested_action, requested_contact_type,
  requested_e164, note, status, created_at,
  pharmacy:dawanear_pharmacies!dawanear_pharmacy_contact_edit_requests_pharmacy_id_fkey(
    name, fda_source_serial, district, province
  ),
  existing_contact:dawanear_pharmacy_contacts!dawanear_pharmacy_contact_edit_requests_contact_id_fkey(
    contact_type, e164, is_primary, is_login_enabled, verification_status
  )
`;

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const adminSecret = Deno.env.get("DAWANEAR_ADMIN_TOKEN");
  const suppliedSecret = request.headers.get("X-DawaNear-Admin-Token") ?? "";
  if (!adminSecret || !secretMatches(suppliedSecret, adminSecret)) {
    return new Response("Forbidden", { status: 403 });
  }
  const serviceKey = elevatedSupabaseKey();
  if (!serviceKey) return new Response("Supabase elevated key is not configured", { status: 503 });

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

  const action = String(body.action || "");
  if (!new Set(["list", "inspect", "approve", "reject"]).has(action)) {
    return Response.json({ error: "Action must be list, inspect, approve, or reject." }, { status: 400 });
  }
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  if (action !== "list" && !requestId) {
    return Response.json({ error: `${action} requires exactly one request_id.` }, { status: 400 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  if (action === "list") {
    const limit = Number(body.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return Response.json({ error: "limit must be an integer from 1 to 50." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("dawanear_pharmacy_contact_edit_requests")
      .select(reviewSelect)
      .eq("status", "pending")
      .order("created_at")
      .limit(limit);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ pending: data?.length ?? 0, requests: data ?? [] });
  }

  if (action === "inspect") {
    const { data, error } = await supabase
      .from("dawanear_pharmacy_contact_edit_requests")
      .select(reviewSelect)
      .eq("id", requestId)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Contact edit request was not found." }, { status: 404 });
    return Response.json({ request: data });
  }

  const reviewedBy = typeof body.reviewed_by === "string" ? body.reviewed_by.trim() : "";
  const reviewNote = typeof body.review_note === "string" ? body.review_note.trim() : "";
  if (reviewedBy.length < 3 || reviewedBy.length > 200 || reviewNote.length < 10 || reviewNote.length > 2000) {
    return Response.json({ error: "Review requires a 3-200 character reviewer identity and 10-2000 character evidence note." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("dawanear_review_pharmacy_contact_edit", {
    p_request_id: requestId,
    p_decision: action,
    p_reviewed_by_label: reviewedBy,
    p_review_note: reviewNote,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json(data);
});

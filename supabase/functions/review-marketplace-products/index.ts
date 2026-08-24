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

const productSelect = `
  id, asin, product_name, brand_name, product_type, category, subcategory,
  publication_status, compliance_status,
  compliance_evidence_url, reviewed_by_label, review_note,
  reviewed_at, approved_at, is_active, is_orderable, amazon_product_url,
  rwanda_match_status, rwanda_match_score, rwanda_product_url, updated_at
`;
const decisions = new Set(["start_review", "compliance_review", "approve", "reject", "unpublish"]);
const statuses = new Set(["research_candidate", "catalogue_review", "approved", "rejected"]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }

  // MED+250 is the canonical operator interface. The legacy fallbacks keep the
  // currently deployed secret and older trusted clients working during rotation.
  const adminSecret = Deno.env.get("MED250_ADMIN_TOKEN") ?? Deno.env.get("DAWANEAR_ADMIN_TOKEN") ?? "";
  const suppliedSecret = request.headers.get("X-MED250-Admin-Token") ?? request.headers.get("X-DawaNear-Admin-Token") ?? "";
  if (!adminSecret || !secretMatches(suppliedSecret, adminSecret)) {
    return new Response("Forbidden", { status: 403 });
  }
  const serviceKey = elevatedSupabaseKey();
  if (!serviceKey) return new Response("Supabase elevated key is not configured", { status: 503 });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  if (action !== "list" && action !== "inspect" && !decisions.has(action)) {
    return Response.json({ error: "Action must be list, inspect, start_review, compliance_review, approve, reject, or unpublish." }, { status: 400 });
  }
  const productId = String(body.product_id ?? "").trim();
  if (action !== "list" && !/^AMZ-[A-Z0-9]{10}$/.test(productId)) {
    return Response.json({ error: `${action} requires exactly one valid product_id.` }, { status: 400 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (action === "list") {
    const limit = Number(body.limit ?? 25);
    const status = String(body.status ?? "research_candidate").trim();
    const category = String(body.category ?? "").trim();
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return Response.json({ error: "limit must be an integer from 1 to 100." }, { status: 400 });
    }
    if (!statuses.has(status)) return Response.json({ error: "Unsupported publication status." }, { status: 400 });
    let query = supabase
      .from("dawanear_marketplace_products")
      .select(productSelect)
      .eq("publication_status", status)
      .order("assortment_score", { ascending: false })
      .order("id")
      .limit(limit);
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ status, count: data?.length ?? 0, products: data ?? [] });
  }

  if (action === "inspect") {
    const [{ data: product, error }, { data: reviews, error: reviewError }] = await Promise.all([
      supabase.from("dawanear_marketplace_products").select(productSelect).eq("id", productId).maybeSingle(),
      supabase.from("dawanear_marketplace_product_reviews")
        .select("id,decision,reviewed_by_label,evidence_note,compliance_evidence_url,expected_product_updated_at,previous_state,resulting_state,created_at")
        .eq("product_id", productId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (error || reviewError) return Response.json({ error: error?.message ?? reviewError?.message }, { status: 500 });
    if (!product) return Response.json({ error: "Marketplace product was not found." }, { status: 404 });
    return Response.json({ product, reviews: reviews ?? [] });
  }

  const reviewer = String(body.reviewed_by ?? "").trim();
  const evidenceNote = String(body.evidence_note ?? "").trim();
  const expectedUpdatedAt = String(body.expected_updated_at ?? "").trim();
  const complianceEvidenceUrl = String(body.compliance_evidence_url ?? "").trim() || null;
  if (reviewer.length < 3 || reviewer.length > 200 || evidenceNote.length < 20 || evidenceNote.length > 4000) {
    return Response.json({ error: "Decision requires a 3-200 character reviewer and 20-4000 character evidence note." }, { status: 400 });
  }
  if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return Response.json({ error: "A valid expected_updated_at from inspect is required." }, { status: 400 });
  }
  if (complianceEvidenceUrl && !complianceEvidenceUrl.startsWith("https://")) {
    return Response.json({ error: "Evidence references must be HTTPS URLs." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("dawanear_review_marketplace_product", {
    p_product_id: productId,
    p_decision: action,
    p_reviewed_by_label: reviewer,
    p_evidence_note: evidenceNote,
    p_expected_updated_at: expectedUpdatedAt,
    p_compliance_evidence_url: complianceEvidenceUrl,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  return Response.json({ product: data });
});

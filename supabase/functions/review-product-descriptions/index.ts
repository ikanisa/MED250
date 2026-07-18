import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const backendContractVersion = "2026-07-18.3";
const reviewerContractVersion = "product-description-reviewer-2026-07-18.1";
const reviewerHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-MED250-Backend-Contract": backendContractVersion,
  "X-MED250-Reviewer-Contract": reviewerContractVersion,
};

function plainResponse(body: string, status: number) {
  return new Response(body, { status, headers: reviewerHeaders });
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: reviewerHeaders });
}

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

const productIdPattern = /^(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const timezoneTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const productSelect = `
  id, brand_name, generic_name, strength, dosage_form, pack_size,
  product_type, category, source_name, source_url,
  description, description_source_name, description_source_url,
  description_source_sha256, description_rights_basis,
  description_rights_reference, description_rights_verified,
  description_clinical_review_status, description_review_note,
  description_reviewed_by, description_reviewed_role,
  description_reviewed_at, description_approved, updated_at
`;

function text(body: Record<string, unknown>, key: string) {
  return String(body[key] ?? "").trim();
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return plainResponse("Method not allowed", 405);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return jsonResponse({ error: "Request body is too large." }, 413);
  }

  const adminSecret = Deno.env.get("MED250_ADMIN_TOKEN") ?? Deno.env.get("DAWANEAR_ADMIN_TOKEN") ?? "";
  const suppliedSecret = request.headers.get("X-MED250-Admin-Token") ?? request.headers.get("X-DawaNear-Admin-Token") ?? "";
  if (!adminSecret || !secretMatches(suppliedSecret, adminSecret)) {
    return plainResponse("Forbidden", 403);
  }
  const serviceKey = elevatedSupabaseKey();
  if (!serviceKey) return plainResponse("Supabase elevated key is not configured", 503);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return jsonResponse({ error: "Request body must be a JSON object." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const action = text(body, "action");
  if (!new Set(["inspect", "approve", "withdraw"]).has(action)) {
    return jsonResponse({ error: "Action must be inspect, approve, or withdraw." }, 400);
  }
  const productId = text(body, "product_id");
  if (!productIdPattern.test(productId)) {
    return jsonResponse({ error: "Action requires exactly one valid product_id." }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (action === "inspect") {
    const [{ data: product, error }, { data: reviews, error: reviewError }] = await Promise.all([
      supabase.from("dawanear_products").select(productSelect).eq("id", productId).maybeSingle(),
      supabase.from("dawanear_product_description_reviews")
        .select("id,decision,source_name,source_url,source_sha256,rights_reference,rights_verified,clinical_review_status,review_note,reviewed_by,reviewed_role,reviewed_at,expected_product_updated_at,previous_state,resulting_state,created_at")
        .eq("product_id", productId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (error || reviewError) return jsonResponse({ error: error?.message ?? reviewError?.message }, 500);
    if (!product) return jsonResponse({ error: "Product was not found." }, 404);
    return jsonResponse({ product, reviews: reviews ?? [] });
  }

  const expectedUpdatedAt = text(body, "expected_updated_at");
  const reviewedBy = text(body, "reviewed_by");
  const reviewedRole = text(body, "reviewed_role");
  const reviewedAt = text(body, "reviewed_at");
  const reviewNote = text(body, "review_note");
  if (!timezoneTimestampPattern.test(expectedUpdatedAt) || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return jsonResponse({ error: "A timezone-qualified expected_updated_at from inspect is required." }, 400);
  }
  if (!timezoneTimestampPattern.test(reviewedAt) || !Number.isFinite(Date.parse(reviewedAt))) {
    return jsonResponse({ error: "A timezone-qualified reviewed_at is required." }, 400);
  }
  if (reviewedBy.length < 2 || reviewedBy.length > 160 || reviewedRole.length < 2 || reviewedRole.length > 160) {
    return jsonResponse({ error: "Reviewer identity and role must each be 2-160 characters." }, 400);
  }
  if (reviewNote.length < 20 || reviewNote.length > 1000) {
    return jsonResponse({ error: "Review note must be 20-1000 characters." }, 400);
  }

  const description = action === "approve" ? String(body.description ?? "") : null;
  const sourceName = action === "approve" ? text(body, "source_name") : null;
  const sourceUrl = action === "approve" ? text(body, "source_url") : null;
  const sourceSha256 = action === "approve" ? text(body, "source_sha256").toLowerCase() : null;
  const rightsBasis = action === "approve" ? text(body, "rights_basis") : null;
  const rightsReference = action === "approve" ? text(body, "rights_reference") : null;
  const rightsVerified = action === "approve" && body.rights_verified === true;
  const clinicalReviewStatus = action === "approve" ? text(body, "clinical_review_status") : "not_reviewed";
  if (action === "approve") {
    if (!description || description.length < 40 || description.length > 2000 || description.trim() !== description || /[\u0000-\u001f\u007f]/.test(description)) {
      return jsonResponse({ error: "Description must be 40-2000 trimmed characters without control characters." }, 400);
    }
    if (!sourceName || sourceName.length > 160 || !sourceUrl?.startsWith("https://") || !sha256Pattern.test(sourceSha256 ?? "")) {
      return jsonResponse({ error: "Complete HTTPS source name, URL, and SHA-256 evidence are required." }, 400);
    }
    if ((rightsBasis?.length ?? 0) < 20 || (rightsBasis?.length ?? 0) > 500 || (rightsReference?.length ?? 0) < 12 || (rightsReference?.length ?? 0) > 500 || !rightsVerified) {
      return jsonResponse({ error: "Verified reuse rights and a durable rights reference are required." }, 400);
    }
    if (!new Set(["approved", "not_required"]).has(clinicalReviewStatus ?? "")) {
      return jsonResponse({ error: "Clinical review status must be approved or not_required." }, 400);
    }
  }

  const { data, error } = await supabase.rpc("dawanear_review_product_description", {
    p_product_id: productId,
    p_decision: action,
    p_expected_updated_at: expectedUpdatedAt,
    p_reviewed_by: reviewedBy,
    p_reviewed_role: reviewedRole,
    p_reviewed_at: reviewedAt,
    p_review_note: reviewNote,
    p_description: description,
    p_source_name: sourceName,
    p_source_url: sourceUrl,
    p_source_sha256: sourceSha256,
    p_rights_basis: rightsBasis,
    p_rights_reference: rightsReference,
    p_rights_verified: rightsVerified,
    p_clinical_review_status: clinicalReviewStatus,
  });
  if (error) return jsonResponse({ error: error.message }, 409);
  return jsonResponse({ product: data });
});

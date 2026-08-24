import { PayloadTooLargeError, readBodyText, readResponseText } from "./bounded-body.ts";
import { OperatorRepository, type OperatorRow } from "./operator-repository.ts";
import {
  googleMapsApiKey,
  operatorAdminToken,
  d1Database,
} from "./runtime-env.ts";
import { constantTimeEqualHex, sha256Hex } from "./secure-token.ts";

const BODY_LIMIT = 40 * 1024;
const GOOGLE_RESPONSE_LIMIT = 96 * 1024;
const BEARER = /^Bearer ([\x21-\x7e]{32,256})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$/;
const AMAZON_ID = /^AMZ-[A-Z0-9]{10}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OPERATOR_PREFIX = "/api/internal/operator/";
const OPERATOR_PATHS = new Set([
  `${OPERATOR_PREFIX}geocode`,
  `${OPERATOR_PREFIX}contacts`,
  `${OPERATOR_PREFIX}products`,
  `${OPERATOR_PREFIX}descriptions`,
]);

type JsonObject = Record<string, unknown>;

export class OperatorHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorHttpError";
    this.status = status;
    this.code = code;
  }
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-MED250-Operator-Contract": "worker-d1-operator-v1",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof OperatorHttpError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  if (code === "P0002") return json({ error: "not_found", message: "The governed record was not found." }, 404);
  if (["23505", "23514", "40001", "55000"].includes(typeof code === "string" ? code : "")) {
    return json({ error: "review_conflict", message: "The governed record changed or is not eligible for this decision. Inspect it again." }, 409);
  }
  return json({ error: "operator_unavailable", message: "The governed operator service is temporarily unavailable." }, 503);
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

async function authorized(request: Request, expectedToken: string): Promise<boolean> {
  const supplied = BEARER.exec(request.headers.get("Authorization") ?? "")?.[1]
    ?? "med250-missing-operator-bearer-token";
  const [suppliedHash, expectedHash] = await Promise.all([
    sha256Hex(supplied),
    sha256Hex(expectedToken),
  ]);
  return constantTimeEqualHex(suppliedHash, expectedHash);
}

async function body(request: Request): Promise<JsonObject> {
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new OperatorHttpError(415, "json_required", "A JSON request body is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBodyText(request, BODY_LIMIT));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      throw new OperatorHttpError(413, "payload_too_large", "The request body exceeds the operator limit.");
    }
    throw new OperatorHttpError(400, "invalid_json", "The request body is invalid.");
  }
  const result = object(parsed);
  if (!result) throw new OperatorHttpError(400, "invalid_json", "The request body must be a JSON object.");
  return result;
}

function stringValue(input: JsonObject, key: string, minimum: number, maximum: number): string {
  const value = input[key];
  if (typeof value !== "string") throw new OperatorHttpError(400, "invalid_request", `${key} is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw new OperatorHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return trimmed;
}

function optionalString(input: JsonObject, key: string, maximum: number): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new OperatorHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return value.trim() || null;
}

function integerValue(input: JsonObject, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = input[key] ?? fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new OperatorHttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return Number(value);
}

function uuidValue(input: JsonObject, key: string): string {
  const value = stringValue(input, key, 36, 36).toLowerCase();
  if (!UUID.test(value)) throw new OperatorHttpError(400, "invalid_request", `${key} is invalid.`);
  return value;
}

function timestampValue(input: JsonObject, key: string): string {
  const value = stringValue(input, key, 16, 40);
  if (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new OperatorHttpError(400, "invalid_request", `${key} must include an explicit timezone.`);
  }
  return value;
}

function rowTimestamp(row: OperatorRow, key: string): string {
  const value: unknown = Reflect.get(row, key);
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new Error(`Operator row ${key} is invalid.`);
  return date.toISOString();
}

function rowString(row: OperatorRow, key: string): string {
  const value: unknown = Reflect.get(row, key);
  if (typeof value !== "string" || !value) throw new Error(`Operator row ${key} is invalid.`);
  return value;
}

function normalizedPharmacyName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(?:pharmacy|pharmacie|limited|ltd)/g, "");
}

type GoogleCandidate = {
  id: string;
  formattedAddress: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
  confidence: number;
};

async function googleCandidate(row: OperatorRow, apiKey: string, fetcher: typeof fetch): Promise<GoogleCandidate | null> {
  const name = rowString(row, "name");
  const localityParts = [Reflect.get(row, "sector_cell_raw"), Reflect.get(row, "district"), Reflect.get(row, "province")]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const textQuery = [name, ...localityParts, "Rwanda"].join(", ").slice(0, 1_000);
  let response: Response;
  try {
    response = await fetcher("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri",
      },
      body: JSON.stringify({
        textQuery,
        includedType: "pharmacy",
        strictTypeFiltering: true,
        languageCode: "en",
        regionCode: "RW",
        maxResultCount: 5,
        locationBias: { circle: { center: { latitude: -1.9403, longitude: 29.8739 }, radius: 250_000 } },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new OperatorHttpError(503, "maps_unavailable", "Google Places candidate generation is temporarily unavailable.");
  }
  if (!response.ok) {
    await response.body?.cancel("google_places_error");
    throw new OperatorHttpError(503, "maps_unavailable", "Google Places candidate generation is temporarily unavailable.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readResponseText(response, GOOGLE_RESPONSE_LIMIT));
  } catch {
    throw new OperatorHttpError(503, "maps_unavailable", "Google Places returned an invalid bounded response.");
  }
  const places: unknown = object(payload)?.places;
  if (!Array.isArray(places)) return null;
  const sourceName = normalizedPharmacyName(name);
  const locality = localityParts.map((value) => value.split(/\s+/)[0]?.toLowerCase()).filter(Boolean);
  const ranked: GoogleCandidate[] = [];
  for (const value of places.slice(0, 5)) {
    const candidate = object(value);
    const location = object(candidate?.location);
    const displayName = object(candidate?.displayName)?.text;
    const id = candidate?.id;
    const formattedAddress = candidate?.formattedAddress;
    const mapsUrl = candidate?.googleMapsUri;
    const latitude = location?.latitude;
    const longitude = location?.longitude;
    if (
      typeof id !== "string" || id.length < 1 || id.length > 300
      || typeof displayName !== "string"
      || typeof formattedAddress !== "string" || formattedAddress.length < 3 || formattedAddress.length > 1_000
      || typeof mapsUrl !== "string" || !mapsUrl.startsWith("https://") || mapsUrl.length > 2_000
      || typeof latitude !== "number" || typeof longitude !== "number"
      || latitude < -3 || latitude > -0.8 || longitude < 28.7 || longitude > 30.9
    ) continue;
    const candidateName = normalizedPharmacyName(displayName);
    const nameScore = sourceName === candidateName
      ? 1
      : sourceName.includes(candidateName) || candidateName.includes(sourceName) ? 0.86 : 0.55;
    const address = formattedAddress.toLowerCase();
    const confidence = Math.min(1, nameScore + (locality.some((part) => address.includes(part)) ? 0.1 : 0));
    if (confidence >= 0.8) ranked.push({ id, formattedAddress, mapsUrl, latitude, longitude, confidence });
  }
  ranked.sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
  return ranked[0] ?? null;
}

async function geocodeRoute(
  input: JsonObject,
  repository: OperatorRepository,
  mapsKey: string | null,
  fetcher: typeof fetch,
): Promise<Response> {
  const action = stringValue(input, "action", 1, 20);
  if (action === "inspect") {
    const pharmacyId = uuidValue(input, "pharmacy_id");
    const rows = await repository.geocodeCandidates(pharmacyId, 1);
    if (!rows[0]) throw new OperatorHttpError(404, "not_found", "The pharmacy was not found.");
    if (Reflect.get(rows[0], "geocode_status") !== "candidate") {
      throw new OperatorHttpError(409, "candidate_required", "The pharmacy has no staged candidate to review.");
    }
    return json({ processed: 1, candidate: rows[0] });
  }
  if (action === "approve") {
    const pharmacyId = uuidValue(input, "pharmacy_id");
    const placeId = stringValue(input, "google_place_id", 1, 300);
    const reviewedBy = stringValue(input, "reviewed_by", 3, 200);
    const reviewNote = stringValue(input, "review_note", 10, 2_000);
    const rows = await repository.geocodeCandidates(pharmacyId, 1);
    const current = rows[0];
    if (!current) throw new OperatorHttpError(404, "not_found", "The pharmacy was not found.");
    if (Reflect.get(current, "geocode_status") !== "candidate" || Reflect.get(current, "google_place_id") !== placeId) {
      throw new OperatorHttpError(409, "candidate_changed", "The staged candidate changed. Inspect it again.");
    }
    const receipt = await repository.approveGeocode({
      pharmacyId,
      placeId,
      expectedUpdatedAt: rowTimestamp(current, "candidate_version"),
      reviewedBy,
      reviewNote,
    });
    return json({ processed: 1, approved: 1, results: [receipt] });
  }
  if (action !== "generate") throw new OperatorHttpError(400, "invalid_action", "Action must be generate, inspect, or approve.");
  if (!mapsKey) throw new OperatorHttpError(503, "maps_not_configured", "Google Places candidate generation is not configured.");
  const pharmacyId = optionalString(input, "pharmacy_id", 36);
  if (pharmacyId && !UUID.test(pharmacyId)) throw new OperatorHttpError(400, "invalid_request", "pharmacy_id is invalid.");
  const limit = integerValue(input, "batch_limit", 1, 1, 25);
  const rows = await repository.geocodeCandidates(pharmacyId, limit);
  if (pharmacyId && !rows[0]) throw new OperatorHttpError(404, "not_found", "The pharmacy was not found.");
  const results: unknown[] = [];
  for (const row of rows) {
    if (Reflect.get(row, "geocode_status") === "verified") {
      results.push({ pharmacy_id: Reflect.get(row, "id"), status: "already_verified" });
      continue;
    }
    const candidate = await googleCandidate(row, mapsKey, fetcher);
    if (!candidate) {
      const rejected = await repository.rejectGeocode(rowString(row, "id"), rowTimestamp(row, "candidate_version"));
      results.push({ pharmacy_id: Reflect.get(row, "id"), status: rejected ? "no_match" : "stale_candidate" });
      continue;
    }
    results.push(await repository.stageGeocode({
      pharmacyId: rowString(row, "id"),
      expectedUpdatedAt: rowTimestamp(row, "candidate_version"),
      placeId: candidate.id,
      formattedAddress: candidate.formattedAddress,
      mapsUrl: candidate.mapsUrl,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      confidence: candidate.confidence,
    }));
  }
  return json({ processed: results.length, results });
}

async function contactRoute(input: JsonObject, repository: OperatorRepository): Promise<Response> {
  const action = stringValue(input, "action", 1, 20);
  if (action === "list") {
    const requests = await repository.contactRequests(null, integerValue(input, "limit", 25, 1, 50));
    return json({ pending: requests.length, requests });
  }
  const requestId = uuidValue(input, "request_id");
  if (action === "inspect") {
    const requests = await repository.contactRequests(requestId, 1);
    if (!requests[0]) throw new OperatorHttpError(404, "not_found", "The contact change request was not found.");
    return json({ request: requests[0] });
  }
  if (action !== "approve" && action !== "reject") {
    throw new OperatorHttpError(400, "invalid_action", "Action must be list, inspect, approve, or reject.");
  }
  const receipt = await repository.reviewContact({
    requestId,
    decision: action,
    reviewedBy: stringValue(input, "reviewed_by", 3, 200),
    reviewNote: stringValue(input, "review_note", 10, 2_000),
  });
  return json(receipt);
}

async function productRoute(input: JsonObject, repository: OperatorRepository): Promise<Response> {
  const action = stringValue(input, "action", 1, 24);
  const statuses = new Set(["research_candidate", "catalogue_review", "approved", "rejected"]);
  if (action === "list") {
    const status = optionalString(input, "status", 40) ?? "research_candidate";
    if (!statuses.has(status)) throw new OperatorHttpError(400, "invalid_request", "status is invalid.");
    const category = optionalString(input, "category", 200);
    const products = await repository.catalogueProducts({
      productId: null,
      status,
      category,
      limit: integerValue(input, "limit", 25, 1, 100),
    });
    return json({ status, count: products.length, products });
  }
  const productId = stringValue(input, "product_id", 14, 14);
  if (!AMAZON_ID.test(productId)) throw new OperatorHttpError(400, "invalid_request", "product_id is invalid.");
  if (action === "inspect") {
    const [products, reviews] = await Promise.all([
      repository.catalogueProducts({ productId, status: "approved", category: null, limit: 1 }),
      repository.catalogueReviews(productId),
    ]);
    if (!products[0]) throw new OperatorHttpError(404, "not_found", "The catalogue product was not found.");
    return json({ product: products[0], reviews });
  }
  if (!["start_review", "compliance_review", "approve", "reject", "unpublish"].includes(action)) {
    throw new OperatorHttpError(400, "invalid_action", "The catalogue review action is invalid.");
  }
  const evidenceUrl = optionalString(input, "compliance_evidence_url", 2_000);
  if (evidenceUrl && !evidenceUrl.startsWith("https://")) {
    throw new OperatorHttpError(400, "invalid_request", "compliance_evidence_url must use HTTPS.");
  }
  const receipt = await repository.reviewCatalogueProduct({
    productId,
    decision: action,
    reviewedBy: stringValue(input, "reviewed_by", 3, 200),
    evidenceNote: stringValue(input, "evidence_note", 20, 4_000),
    expectedUpdatedAt: timestampValue(input, "expected_updated_at"),
    complianceEvidenceUrl: evidenceUrl,
  });
  return json({ product: receipt });
}

async function descriptionRoute(input: JsonObject, repository: OperatorRepository): Promise<Response> {
  const action = stringValue(input, "action", 1, 20);
  const productId = stringValue(input, "product_id", 14, 80);
  if (!PRODUCT_ID.test(productId)) throw new OperatorHttpError(400, "invalid_request", "product_id is invalid.");
  if (action === "inspect") {
    const [product, reviews] = await Promise.all([
      repository.descriptionProduct(productId),
      repository.descriptionReviews(productId),
    ]);
    if (!product) throw new OperatorHttpError(404, "not_found", "The catalogue product was not found.");
    return json({ product, reviews });
  }
  if (action !== "approve" && action !== "withdraw") {
    throw new OperatorHttpError(400, "invalid_action", "Action must be inspect, approve, or withdraw.");
  }
  const description = action === "approve" ? stringValue(input, "description", 40, 2_000) : null;
  if (description && (description !== Reflect.get(input, "description") || /[\u0000-\u001f\u007f]/.test(description))) {
    throw new OperatorHttpError(400, "invalid_request", "description must be trimmed and contain no control characters.");
  }
  const sourceUrl = action === "approve" ? stringValue(input, "source_url", 8, 2_000) : null;
  const sourceSha256 = action === "approve" ? stringValue(input, "source_sha256", 64, 64).toLowerCase() : null;
  if (sourceUrl && !sourceUrl.startsWith("https://")) throw new OperatorHttpError(400, "invalid_request", "source_url must use HTTPS.");
  if (sourceSha256 && !SHA256.test(sourceSha256)) throw new OperatorHttpError(400, "invalid_request", "source_sha256 is invalid.");
  if (action === "approve" && input.rights_verified !== true) {
    throw new OperatorHttpError(400, "invalid_request", "rights_verified must be true.");
  }
  const clinical = action === "approve" ? stringValue(input, "clinical_review_status", 8, 20) : "not_reviewed";
  if (action === "approve" && !["approved", "not_required"].includes(clinical)) {
    throw new OperatorHttpError(400, "invalid_request", "clinical_review_status is invalid.");
  }
  const receipt = await repository.reviewDescription({
    productId,
    decision: action,
    expectedUpdatedAt: timestampValue(input, "expected_updated_at"),
    reviewedBy: stringValue(input, "reviewed_by", 2, 160),
    reviewedRole: stringValue(input, "reviewed_role", 2, 160),
    reviewedAt: timestampValue(input, "reviewed_at"),
    reviewNote: stringValue(input, "review_note", 20, 1_000),
    description,
    sourceName: action === "approve" ? stringValue(input, "source_name", 2, 160) : null,
    sourceUrl,
    sourceSha256,
    rightsBasis: action === "approve" ? stringValue(input, "rights_basis", 20, 500) : null,
    rightsReference: action === "approve" ? stringValue(input, "rights_reference", 12, 500) : null,
    rightsVerified: action === "approve",
    clinicalReviewStatus: clinical,
  });
  return json({ product: receipt });
}

async function authorizedResponse(
  request: Request,
  repository: OperatorRepository,
  mapsKey: string | null,
  fetcher: typeof fetch,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }
  try {
    const input = await body(request);
    const pathname = new URL(request.url).pathname;
    if (pathname === `${OPERATOR_PREFIX}geocode`) return await geocodeRoute(input, repository, mapsKey, fetcher);
    if (pathname === `${OPERATOR_PREFIX}contacts`) return await contactRoute(input, repository);
    if (pathname === `${OPERATOR_PREFIX}products`) return await productRoute(input, repository);
    if (pathname === `${OPERATOR_PREFIX}descriptions`) return await descriptionRoute(input, repository);
    return json({ error: "not_found", message: "Operator route not found." }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function operatorApiResponse(
  request: Request,
  repository: OperatorRepository,
  expectedToken: string,
  mapsKey: string | null = null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!OPERATOR_PATHS.has(new URL(request.url).pathname)) return json({ error: "not_found" }, 404);
  if (!(await authorized(request, expectedToken))) return json({ error: "unauthorized" }, 401);
  return authorizedResponse(request, repository, mapsKey, fetcher);
}

export async function operatorResponse(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!OPERATOR_PATHS.has(pathname)) return null;
  const expectedToken = operatorAdminToken(env);
  if (!(await authorized(request, expectedToken))) return json({ error: "unauthorized" }, 401);
  const mapsKey = pathname === `${OPERATOR_PREFIX}geocode` ? googleMapsApiKey(env) : null;
  return authorizedResponse(request, new OperatorRepository(d1Database(env)), mapsKey, fetch);
}

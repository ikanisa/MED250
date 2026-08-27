const EVENT_NAMES = new Set([
  "catalogue_search",
  "catalogue_hierarchy_selected",
  "catalogue_view_changed",
  "product_added",
  "order_started",
  "order_placed",
  "order_failed",
  "pharmacy_selected",
  "whatsapp_handoff",
  "momo_handoff",
]);

const CATEGORIES = new Set(["Medicines", "Personal care", "Baby & family", "Wellness & devices"]);
const MAX_BODY_BYTES = 2048;

async function readBoundedText(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel("telemetry body exceeds byte limit");
      throw new RangeError("telemetry body exceeds byte limit");
    }
    result += decoder.decode(value, { stream: true });
  }
}

function numberValue(properties: Record<string, unknown>, name: string) {
  const value = properties[name];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanValue(properties: Record<string, unknown>, name: string) {
  return typeof properties[name] === "boolean" ? properties[name] : null;
}

function bucket(value: number | null, boundaries: number[]) {
  if (value === null) return null;
  const upper = boundaries.find((boundary) => value <= boundary);
  return upper === undefined ? `>${boundaries.at(-1)}` : `<=${upper}`;
}

function sanitizeProperties(name: string, properties: Record<string, unknown>) {
  if (name === "catalogue_search") {
    const source = properties.source === "worker" || properties.source === "supabase" || properties.source === "client" ? properties.source : null;
    return {
      source,
      query_length_bucket: bucket(numberValue(properties, "queryLength"), [0, 3, 10, 25]),
      result_count_bucket: bucket(numberValue(properties, "resultCount"), [0, 12, 48, 120]),
      duration_ms_bucket: bucket(numberValue(properties, "durationMs"), [100, 250, 500, 1000, 2500]),
    };
  }
  if (name === "catalogue_hierarchy_selected") {
    return {
      category: typeof properties.category === "string" && CATEGORIES.has(properties.category) ? properties.category : "Other",
    };
  }
  if (name === "catalogue_view_changed") {
    return { view: properties.view === "grid" || properties.view === "list" ? properties.view : null };
  }
  if (name === "product_added") {
    return {
      category: typeof properties.category === "string" && CATEGORIES.has(properties.category) ? properties.category : "Other",
      has_price: booleanValue(properties, "hasPrice"),
    };
  }
  if (name === "order_started") {
    return {
      item_kinds_bucket: bucket(numberValue(properties, "itemKinds"), [1, 3, 6, 12]),
      item_count_bucket: bucket(numberValue(properties, "itemCount"), [1, 3, 6, 12, 24]),
      prescription_required: booleanValue(properties, "prescriptionRequired"),
    };
  }
  if (name === "order_placed") {
    return {
      item_kinds_bucket: bucket(numberValue(properties, "itemKinds"), [1, 3, 6, 12]),
      prescription_attached: booleanValue(properties, "prescriptionAttached"),
      dispatch_succeeded: booleanValue(properties, "dispatchSucceeded"),
    };
  }
  if (name === "order_failed") {
    return { stage: properties.stage === "dispatch" || properties.stage === "validation" ? properties.stage : null };
  }
  if (name === "pharmacy_selected") {
    return {
      has_whatsapp: booleanValue(properties, "hasWhatsapp"),
      has_momo_code: booleanValue(properties, "hasMomoCode"),
    };
  }
  if (name === "whatsapp_handoff" || name === "momo_handoff") {
    return { configured: booleanValue(properties, "configured") };
  }
  return {};
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ accepted: false }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  let rawBody = "";
  try {
    rawBody = await readBoundedText(request);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Response.json({ accepted: false }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  let body: { name?: unknown; properties?: unknown } | null = null;
  try {
    body = JSON.parse(rawBody) as { name?: unknown; properties?: unknown };
  } catch {
    body = null;
  }
  if (!body || typeof body.name !== "string" || !EVENT_NAMES.has(body.name)) {
    return Response.json({ accepted: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const rawProperties = body.properties && typeof body.properties === "object" && !Array.isArray(body.properties)
    ? body.properties as Record<string, unknown>
    : {};
  const properties = sanitizeProperties(body.name, rawProperties);

  console.info(JSON.stringify({
    event: "marketplace_signal",
    name: body.name,
    properties,
    recordedAt: new Date().toISOString(),
  }));

  return Response.json({ accepted: true }, {
    status: 202,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

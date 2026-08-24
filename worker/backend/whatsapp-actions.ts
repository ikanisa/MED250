const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WhatsAppAction =
  | { kind: "use_saved"; requestId: string; locationId: string }
  | { kind: "share_new"; requestId: string }
  | { kind: "pharmacy_response"; response: "can_fulfil" | "cannot_fulfil"; requestId: string; pharmacyId: string };

export function parseClientAction(payload: string): WhatsAppAction | null {
  const parts = payload.trim().toLowerCase().split(":");
  if (parts.length === 5 && parts[0] === "med250" && parts[1] === "loc" && parts[2] === "saved") {
    return UUID.test(parts[3]) && UUID.test(parts[4])
      ? { kind: "use_saved", requestId: parts[3], locationId: parts[4] }
      : null;
  }
  if (parts.length === 4 && parts[0] === "med250" && parts[1] === "loc" && parts[2] === "new") {
    return UUID.test(parts[3]) ? { kind: "share_new", requestId: parts[3] } : null;
  }
  if (
    parts.length === 5
    && parts[0] === "med250"
    && parts[1] === "media"
    && (parts[2] === "can" || parts[2] === "cannot")
    && UUID.test(parts[3])
    && UUID.test(parts[4])
  ) {
    return {
      kind: "pharmacy_response",
      response: parts[2] === "can" ? "can_fulfil" : "cannot_fulfil",
      requestId: parts[3],
      pharmacyId: parts[4],
    };
  }
  if (
    parts.length === 4
    && parts[0] === "med250"
    && (parts[1] === "can" || parts[1] === "cannot")
    && UUID.test(parts[2])
    && UUID.test(parts[3])
  ) {
    return {
      kind: "pharmacy_response",
      response: parts[1] === "can" ? "can_fulfil" : "cannot_fulfil",
      requestId: parts[2],
      pharmacyId: parts[3],
    };
  }
  return null;
}

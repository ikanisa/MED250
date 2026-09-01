const API_RESPONSE_LIMIT = 4 * 1024 * 1024;
const API_TIMEOUT_MS = 10_000;
const CLIENT_CSRF_COOKIE = "__Host-med250-client-csrf";
const PHARMACY_CSRF_COOKIE = "__Host-med250-pharmacy-csrf";
const ADMIN_CSRF_COOKIE = "__Host-med250-admin-csrf";

function browserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [foundName, ...valueParts] = part.trim().split("=");
    if (foundName === name) return valueParts.join("=") || null;
  }
  return null;
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > API_RESPONSE_LIMIT) throw new Error("MED250 returned an oversized response.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > API_RESPONSE_LIMIT) {
        await reader.cancel("response_too_large");
        throw new Error("MED250 returned an oversized response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function med250ApiJson(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw new Error("MED250 API path is invalid.");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("X-MED250-CSRF")) {
    const cookieName = path.startsWith("/api/auth/admin/") || path.startsWith("/api/admin/")
      ? ADMIN_CSRF_COOKIE
      : path.startsWith("/api/auth/pharmacy/")
        ? PHARMACY_CSRF_COOKIE
        : CLIENT_CSRF_COOKIE;
    const csrf = browserCookie(cookieName);
    if (csrf) headers.set("X-MED250-CSRF", csrf);
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
    signal: init.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const body = await boundedResponseText(response);
  let payload: unknown = null;
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("MED250 returned an invalid response.");
    }
  }
  if (!response.ok) {
    const code = typeof payload === "object" && payload !== null && typeof Reflect.get(payload, "error") === "string"
      ? Reflect.get(payload, "error")
      : `http_${response.status}`;
    const message = typeof payload === "object" && payload !== null && typeof Reflect.get(payload, "message") === "string"
      ? String(Reflect.get(payload, "message")).slice(0, 500)
      : `MED250 API request failed: ${code}.`;
    throw new Error(message);
  }
  return payload;
}

export function jsonRequest(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

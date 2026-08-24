const RESPONSE_LIMIT = 256 * 1024;

export function resolveWorkerOperatorEndpoint(pathname, environment = process.env) {
  if (!/^\/api\/internal\/operator\/[a-z-]+$/.test(pathname)) {
    throw new Error("Worker operator path is invalid.");
  }
  const raw = String(environment.MED250_OPERATOR_ORIGIN || "").trim();
  if (!raw) throw new Error("MED250_OPERATOR_ORIGIN is required in the process environment.");
  const origin = new URL(raw);
  if (
    origin.protocol !== "https:"
    || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname !== "/"
  ) {
    throw new Error("MED250_OPERATOR_ORIGIN must be an HTTPS origin without a path, credentials, query, or fragment.");
  }
  return new URL(pathname, origin);
}

async function boundedResponseText(response, limit = RESPONSE_LIMIT) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel("operator_response_too_large");
    throw new Error("The Worker operator response exceeded its size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("operator_response_too_large");
        throw new Error("The Worker operator response exceeded its size limit.");
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

export async function callWorkerOperator(
  pathname,
  payload,
  { environment = process.env, fetchImpl = fetch, responseLabel = "Operator" } = {},
) {
  const token = String(environment.MED250_ADMIN_TOKEN || "").trim();
  if (token.length < 32 || token.length > 256) {
    throw new Error("MED250_ADMIN_TOKEN must be a 32-256 character process-only secret.");
  }
  const response = await fetchImpl(resolveWorkerOperatorEndpoint(pathname, environment), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await boundedResponseText(response);
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = { error: `${responseLabel} returned a non-JSON response.` };
  }
  if (!response.ok) {
    const message = typeof result?.message === "string"
      ? result.message
      : typeof result?.error === "string" ? result.error : `${responseLabel} returned HTTP ${response.status}.`;
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return result;
}

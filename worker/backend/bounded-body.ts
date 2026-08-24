export class PayloadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds the ${limitBytes}-byte limit.`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readBodyBytes(request: Request, limitBytes: number): Promise<Uint8Array> {
  if (!Number.isInteger(limitBytes) || limitBytes < 1) {
    throw new Error("Body limit must be a positive integer.");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > limitBytes) {
    throw new PayloadTooLargeError(limitBytes);
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel("payload_too_large");
        throw new PayloadTooLargeError(limitBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBodyText(request: Request, limitBytes: number): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readBodyBytes(request, limitBytes));
}

export async function readResponseText(response: Response, limitBytes: number): Promise<string> {
  if (!Number.isInteger(limitBytes) || limitBytes < 1) {
    throw new Error("Response limit must be a positive integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > limitBytes) {
    await response.body?.cancel("payload_too_large");
    throw new PayloadTooLargeError(limitBytes);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel("payload_too_large");
        throw new PayloadTooLargeError(limitBytes);
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

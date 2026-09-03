import { sha256BytesHex } from "./secure-token.ts";

type ImageContentType = "image/jpeg" | "image/png" | "image/webp";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_MEDIA_REDIRECTS = 3;
export const WHATSAPP_IMAGE_MAX_BYTES = 5_000_000;

export class MediaIngestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MediaIngestError";
    this.code = code;
  }
}

export type IngestTwilioImageInput = {
  bucket: R2Bucket;
  accountSid: string;
  authToken: string;
  mediaUrl: string;
  contentType: ImageContentType;
  requestId: string;
  messageSid: string;
  mediaIndex: number;
  maxBytes?: number;
  fetcher?: typeof fetch;
};

export type IngestedMedia = {
  key: string;
  contentType: ImageContentType;
  byteSize: number;
  sha256: string;
  etag: string;
  recovered: boolean;
};

function extension(contentType: ImageContentType): string {
  switch (contentType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
  }
}

function validateImagePrefix(contentType: ImageContentType, prefix: Uint8Array): void {
  const matches = contentType === "image/jpeg"
    ? prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
    : contentType === "image/png"
      ? prefix.length >= 8
        && prefix[0] === 0x89 && prefix[1] === 0x50 && prefix[2] === 0x4e && prefix[3] === 0x47
        && prefix[4] === 0x0d && prefix[5] === 0x0a && prefix[6] === 0x1a && prefix[7] === 0x0a
      : prefix.length >= 12
        && new TextDecoder().decode(prefix.subarray(0, 4)) === "RIFF"
        && new TextDecoder().decode(prefix.subarray(8, 12)) === "WEBP";
  if (!matches) throw new MediaIngestError("image_signature_mismatch", "Downloaded media bytes do not match the declared image type.");
}

function validatedMediaUrl(rawUrl: string, accountSid: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MediaIngestError("invalid_media_url", "Twilio media URL is invalid.");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "api.twilio.com"
    || !url.pathname.includes(`/Accounts/${accountSid}/Messages/`)
  ) {
    throw new MediaIngestError("untrusted_media_url", "Twilio media URL is outside the configured account.");
  }
  return url;
}

function safeRedirectLocation(response: Response, currentUrl: URL): URL {
  const location = response.headers.get("location")?.trim() ?? "";
  if (!location) throw new MediaIngestError("invalid_media_redirect", "Twilio media redirect is missing a destination.");
  let next: URL;
  try {
    next = new URL(location, currentUrl);
  } catch {
    throw new MediaIngestError("invalid_media_redirect", "Twilio media redirect destination is invalid.");
  }
  if (next.protocol !== "https:" || next.username || next.password || (next.port && next.port !== "443")) {
    throw new MediaIngestError("unsafe_media_redirect", "Twilio media redirect destination is not safe HTTPS.");
  }
  return next;
}

async function fetchTwilioMedia(input: IngestTwilioImageInput, mediaUrl: URL): Promise<Response> {
  const fetcher = input.fetcher ?? fetch;
  let currentUrl = mediaUrl;
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= MAX_MEDIA_REDIRECTS; redirects += 1) {
    const current = currentUrl.toString();
    if (visited.has(current)) throw new MediaIngestError("media_redirect_loop", "Twilio media redirect loop detected.");
    visited.add(current);
    const headers = new Headers({ Accept: input.contentType });
    if (redirects === 0) {
      headers.set("Authorization", `Basic ${btoa(`${input.accountSid}:${input.authToken}`)}`);
    }
    const response = await fetcher(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects === MAX_MEDIA_REDIRECTS) {
      await response.body?.cancel("redirect_limit");
      throw new MediaIngestError("media_redirect_limit", "Twilio media exceeded the redirect limit.");
    }
    const next = safeRedirectLocation(response, currentUrl);
    await response.body?.cancel("redirect_followed");
    currentUrl = next;
  }
  throw new MediaIngestError("media_redirect_limit", "Twilio media exceeded the redirect limit.");
}

function immutableObjectKey(input: IngestTwilioImageInput): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.requestId)) {
    throw new MediaIngestError("invalid_request_id", "Media request ID is invalid.");
  }
  if (!/^(?:SM|MM)[0-9a-f]{32}$/i.test(input.messageSid)) {
    throw new MediaIngestError("invalid_message_sid", "Twilio Message SID is invalid.");
  }
  if (!Number.isInteger(input.mediaIndex) || input.mediaIndex < 0 || input.mediaIndex > 9) {
    throw new MediaIngestError("invalid_media_index", "Media index must be between zero and nine.");
  }
  return `client-requests/${input.requestId}/${input.messageSid.toUpperCase()}-${input.mediaIndex}.${extension(input.contentType)}`;
}

async function recoverExistingObject(
  input: IngestTwilioImageInput,
  key: string,
  maxBytes: number,
): Promise<IngestedMedia | null> {
  const object = await input.bucket.get(key);
  if (!object) return null;
  if (
    object.httpMetadata?.contentType !== input.contentType
    || object.customMetadata?.requestId !== input.requestId
    || object.customMetadata?.messageSid !== input.messageSid.toUpperCase()
    || object.customMetadata?.mediaIndex !== String(input.mediaIndex)
  ) {
    await object.body.cancel("metadata_mismatch");
    throw new MediaIngestError("existing_object_mismatch", "Existing immutable media metadata does not match this request.");
  }
  if (object.size < 1 || object.size > maxBytes) {
    await object.body.cancel("invalid_size");
    throw new MediaIngestError("existing_object_mismatch", "Existing immutable media size is invalid.");
  }

  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  const byteSize = bytes.byteLength;
  if (byteSize > maxBytes) throw new MediaIngestError("existing_object_mismatch", "Existing immutable media is oversized.");
  validateImagePrefix(input.contentType, bytes.subarray(0, 12));
  if (byteSize !== object.size) throw new MediaIngestError("existing_object_mismatch", "Existing immutable media size changed while reading.");
  return {
    key,
    contentType: input.contentType,
    byteSize,
    sha256: await sha256BytesHex(bytes),
    etag: object.etag,
    recovered: true,
  };
}

export async function ingestTwilioImage(input: IngestTwilioImageInput): Promise<IngestedMedia> {
  const maxBytes = input.maxBytes ?? WHATSAPP_IMAGE_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > WHATSAPP_IMAGE_MAX_BYTES) {
    throw new MediaIngestError("invalid_size_limit", "Media byte limit is invalid.");
  }
  if (!input.authToken) throw new MediaIngestError("missing_auth_token", "Twilio media credential is missing.");
  if (input.contentType === "image/webp") throw new MediaIngestError("unsupported_image_type", "Send a JPG or PNG image, not a sticker.");

  const key = immutableObjectKey(input);
  const existing = await recoverExistingObject(input, key, maxBytes);
  if (existing) return existing;
  const mediaUrl = validatedMediaUrl(input.mediaUrl, input.accountSid);
  const response = await fetchTwilioMedia(input, mediaUrl);
  if (!response.ok || !response.body) {
    throw new MediaIngestError("media_download_failed", `Twilio media download failed with HTTP ${response.status}.`);
  }

  const responseType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (responseType !== input.contentType) {
    throw new MediaIngestError("content_type_mismatch", "Twilio media response type does not match the signed webhook.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    await response.body.cancel("payload_too_large");
    throw new MediaIngestError("media_too_large", `Twilio media exceeds the ${maxBytes}-byte limit.`);
  }

  let byteSize = 0;
  const source = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    while (true) {
      const { done, value } = await source.read();
      if (done) break;
      byteSize += value.byteLength;
      if (byteSize > maxBytes) {
        await source.cancel("payload_too_large");
        throw new MediaIngestError("media_too_large", `Twilio media exceeds the ${maxBytes}-byte limit.`);
      }
      const chunk = new Uint8Array(new ArrayBuffer(value.byteLength));
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    source.releaseLock();
  }
  const bytes = new Uint8Array(new ArrayBuffer(byteSize));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  validateImagePrefix(input.contentType, bytes.subarray(0, 12));

  const object = await input.bucket.put(key, bytes.buffer, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: {
      contentType: input.contentType,
      cacheControl: "private, no-store",
      contentDisposition: "inline",
    },
    customMetadata: {
      requestId: input.requestId,
      messageSid: input.messageSid.toUpperCase(),
      mediaIndex: String(input.mediaIndex),
    },
  });
  if (!object) {
    throw new MediaIngestError("object_already_exists", "Immutable media object already exists and was not overwritten.");
  }

  return {
    key,
    contentType: input.contentType,
    byteSize,
    sha256: await sha256BytesHex(bytes),
    etag: object.etag,
    recovered: false,
  };
}

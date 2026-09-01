const encoder = new TextEncoder();
const META_SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const E164_DIGITS = /^[1-9]\d{7,14}$/;

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error("invalid hex");
  return Uint8Array.from(value.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function enabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function timingSafeText(left, right) {
  return typeof left === "string" && typeof right === "string" &&
    equalBytes(encoder.encode(left), encoder.encode(right));
}

export async function createMetaSignature(secret, body) {
  if (typeof secret !== "string" || encoder.encode(secret.trim()).byteLength < 16) {
    throw new Error("Meta app secret unavailable");
  }
  return `sha256=${hex(await hmac(secret, body))}`;
}

export async function validateMetaSignature(secret, body, supplied) {
  if (typeof secret !== "string" || encoder.encode(secret.trim()).byteLength < 16) return false;
  const match = typeof supplied === "string" ? META_SIGNATURE.exec(supplied) : null;
  if (!match) return false;
  try {
    return equalBytes(await hmac(secret, body), fromHex(match[1]));
  } catch {
    return false;
  }
}

export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function providerIdentifier(value, maximum = 512) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error("invalid provider identifier");
  }
  return result;
}

export function parseCountryCodes(value) {
  const codes = String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (codes.length === 0 || codes.some((item) => !/^\d{1,3}$/.test(item))) {
    throw new Error("country allowlist unavailable");
  }
  return codes;
}

export function normalizeRecipient(value, countryCodes) {
  if (typeof value !== "string" || !E164_DIGITS.test(value)) return null;
  return countryCodes.some((code) => value.startsWith(code)) ? value : null;
}

export function explicitGraphVersion(value) {
  const version = typeof value === "string" ? value.trim() : "";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid Graph API version");
  return version;
}

export function explicitTemplateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error("invalid template name");
  return name;
}

export function safeTemplateText(value, fallback = "", maximum = 1000) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = (raw || fallback)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .slice(0, maximum);
  return normalized || "—";
}

export async function sha256Hex(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function pseudonymousIdentifier(secret, scope, identifier) {
  if (typeof secret !== "string" || encoder.encode(secret.trim()).byteLength < 32 || !scope || !identifier) {
    throw new Error("pseudonym configuration unavailable");
  }
  return hex(await hmac(secret, `${scope}:${identifier}`));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !BASE64URL.test(value)) throw new Error("Token encoding is invalid.");
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // Reject alternate encodings whose unused trailing bits decode to the same
  // bytes. Accepting those would make a signed token textually malleable even
  // though its HMAC bytes are unchanged.
  if (base64UrlEncode(bytes) !== value) throw new Error("Token encoding is not canonical.");
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("Location token secret is invalid.");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function aesKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("Encrypted payload secret is invalid.");
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`med250:web-otp:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export type OtpActorType = "client" | "pharmacy" | "admin";

function otpAdditionalData(input: { challengeId: string; e164: string; actorType: OtpActorType }): Uint8Array<ArrayBuffer> {
  if (!UUID.test(input.challengeId) || !/^[1-9][0-9]{7,14}$/.test(input.e164)) {
    throw new Error("OTP encryption context is invalid.");
  }
  return new Uint8Array(encoder.encode(`med250:web-otp:v1:${input.challengeId.toLowerCase()}:${input.e164}:${input.actorType}`));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256BytesHex(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashOtpCode(
  input: { challengeId: string; e164: string; actorType: OtpActorType; code: string },
  secret: string,
): Promise<string> {
  if (!/^\d{6}$/.test(input.code)) throw new Error("OTP code is invalid.");
  const context = new TextDecoder().decode(otpAdditionalData(input));
  return hmacSha256Hex(secret, `${context}:${input.code}`);
}

export async function encryptOtpCode(
  code: string,
  input: { challengeId: string; e164: string; actorType: OtpActorType },
  secret: string,
): Promise<{ ciphertext: string; nonce: string }> {
  if (!/^\d{6}$/.test(code)) throw new Error("OTP code is invalid.");
  const nonce = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(nonce);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: otpAdditionalData(input), tagLength: 128 },
    await aesKey(secret),
    encoder.encode(code),
  ));
  return { ciphertext: base64UrlEncode(encrypted), nonce: base64UrlEncode(nonce) };
}

export async function decryptOtpCode(
  encrypted: { ciphertext: string; nonce: string },
  input: { challengeId: string; e164: string; actorType: OtpActorType },
  secret: string,
): Promise<string> {
  const nonce = new Uint8Array(base64UrlDecode(encrypted.nonce));
  if (nonce.byteLength !== 12) throw new Error("OTP encryption nonce is invalid.");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: otpAdditionalData(input), tagLength: 128 },
    await aesKey(secret),
    base64UrlDecode(encrypted.ciphertext),
  );
  const code = decoder.decode(clear);
  if (!/^\d{6}$/.test(code)) throw new Error("OTP encrypted payload is invalid.");
  return code;
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function createOpaqueToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

// Owner-approved public support destination. Keep it separate from the US ordering sender.
export const SUPPORT_WHATSAPP_DIGITS = "250795588248";
export const SUPPORT_WHATSAPP_DISPLAY = "+250 795 588 248";
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_DIGITS}`;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function parsePublicEmail(value) {
  const candidate = clean(value).toLowerCase();
  if (!candidate) return null;
  if (hasControlCharacters(candidate) || /\s/.test(candidate)) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(candidate)) return null;
  return {
    label: "email",
    href: `mailto:${candidate}`,
    display: candidate,
  };
}

export function parsePublicWhatsApp(value) {
  const candidate = clean(value);
  if (!candidate) return null;
  if (hasControlCharacters(candidate)) return null;
  const digits = candidate.replace(/[\s()+.-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return {
    label: "whatsapp",
    href: `https://wa.me/${digits}`,
    display: `+${digits}`,
  };
}

export function parsePublicBookingUrl(value) {
  const candidate = clean(value);
  if (!candidate) return null;
  if (hasControlCharacters(candidate)) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return null;
  parsed.hash = "";
  return {
    label: "booking",
    href: parsed.toString(),
    display: parsed.hostname,
  };
}

export function publicContactChannelErrors(env = process.env) {
  const raw = clean(env.NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP);
  if (!raw) return [];
  if (!parsePublicWhatsApp(raw)) return ["NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP is not a safe public contact value."];
  return parsePublicWhatsApp(raw).href === SUPPORT_WHATSAPP_URL ? []
    : ["NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP must match the owner-approved WhatsApp support number."];
}

export function publicContactChannels() {
  // Email/calendar environment values must not silently re-enable unwanted channels.
  return [{ label: "whatsapp", href: SUPPORT_WHATSAPP_URL, display: SUPPORT_WHATSAPP_DISPLAY }];
}

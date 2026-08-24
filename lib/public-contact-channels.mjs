const SAFE_LABELS = new Set(["email", "whatsapp", "booking"]);

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

export function publicContactChannelErrors(env = process.env, { requireAll = false } = {}) {
  const required = {
    NEXT_PUBLIC_MED250_CONTACT_EMAIL: parsePublicEmail,
    NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP: parsePublicWhatsApp,
    NEXT_PUBLIC_MED250_MEETING_URL: parsePublicBookingUrl,
  };
  const errors = [];
  for (const [name, parser] of Object.entries(required)) {
    const raw = clean(env[name]);
    const parsed = parser(raw);
    if (requireAll && !raw) {
      errors.push(`${name} is required for live public contact readiness.`);
    } else if (raw && !parsed) {
      errors.push(`${name} is not a safe public contact value.`);
    }
  }
  return errors;
}

export function publicContactChannels(env = process.env) {
  const channels = [
    parsePublicEmail(env.NEXT_PUBLIC_MED250_CONTACT_EMAIL),
    parsePublicWhatsApp(env.NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP),
    parsePublicBookingUrl(env.NEXT_PUBLIC_MED250_MEETING_URL),
  ].filter(Boolean);
  for (const channel of channels) {
    if (!SAFE_LABELS.has(channel.label)) throw new Error(`Unsupported public contact channel ${channel.label}.`);
  }
  return channels;
}

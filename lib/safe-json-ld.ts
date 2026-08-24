/** Serialize structured data safely for an inline HTML script element. */
export function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

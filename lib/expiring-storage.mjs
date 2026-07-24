export const EXPIRING_STORAGE_VERSION = 2;

export function readExpiringStorage(storage, key, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw);
    const valid = envelope
      && typeof envelope === "object"
      && envelope.version === EXPIRING_STORAGE_VERSION
      && Number.isFinite(envelope.expiresAt)
      && envelope.expiresAt > now
      && Object.prototype.hasOwnProperty.call(envelope, "value");

    if (!valid) {
      storage.removeItem(key);
      return null;
    }

    return envelope.value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeExpiringStorage(storage, key, value, ttlMilliseconds, now = Date.now()) {
  if (!Number.isFinite(ttlMilliseconds) || ttlMilliseconds <= 0) {
    throw new RangeError("Storage TTL must be a positive number of milliseconds");
  }

  storage.setItem(key, JSON.stringify({
    version: EXPIRING_STORAGE_VERSION,
    expiresAt: now + ttlMilliseconds,
    value,
  }));
}

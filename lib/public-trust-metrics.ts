import { cache } from "react";

const PUBLIC_FETCH_TIMEOUT_MS = 8_000;

export type ReadyPharmacyCountMetric = {
  value: number;
  sampleSize: number;
  source: "governed_dispatch_eligibility";
  measurementType: "current_population";
  asOf: string;
};

export type TypicalResponseMetric = {
  valueMinutes: number;
  sampleSize: number;
  source: "completed_first_confirmations";
  percentile: "p50";
  windowDays: number;
  latestObservationAt: string;
  maxStalenessDays: number;
};

export type PublicTrustMetrics = {
  generatedAt: string;
  readyPharmacyCount: ReadyPharmacyCountMetric | null;
  typicalResponse: TypicalResponseMetric | null;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : null;
}

function parsePublicTrustMetrics(payload: unknown): PublicTrustMetrics | null {
  const root = record(Array.isArray(payload) ? payload[0] : payload);
  if (!root || root.schema_version !== 1) return null;
  const privacy = record(root.privacy);
  if (
    privacy?.aggregate_only !== true
    || privacy.contains_pharmacy_identity !== false
    || privacy.contains_customer_or_health_data !== false
  ) return null;

  const generatedAt = timestamp(root.generated_at);
  if (!generatedAt) return null;

  const ready = record(root.ready_pharmacy_count);
  const readyValue = positiveInteger(ready?.value);
  const readySampleSize = positiveInteger(ready?.sample_size);
  const readyAsOf = timestamp(ready?.as_of);
  const readyPharmacyCount = readyValue !== null
    && readySampleSize === readyValue
    && ready?.source === "governed_dispatch_eligibility"
    && ready?.measurement_type === "current_population"
    && readyAsOf
    ? {
        value: readyValue,
        sampleSize: readySampleSize,
        source: "governed_dispatch_eligibility" as const,
        measurementType: "current_population" as const,
        asOf: readyAsOf,
      }
    : null;

  const response = record(root.typical_response_minutes);
  const responseValue = positiveInteger(response?.value);
  const responseSampleSize = positiveInteger(response?.sample_size);
  const responseWindowDays = positiveInteger(response?.window_days);
  const responseMaxStalenessDays = positiveInteger(response?.max_staleness_days);
  const latestObservationAt = timestamp(response?.latest_observation_at);
  const typicalResponse = responseValue !== null
    && responseSampleSize !== null
    && responseWindowDays !== null
    && responseMaxStalenessDays !== null
    && latestObservationAt
    && response?.source === "completed_first_confirmations"
    && response?.percentile === "p50"
    ? {
        valueMinutes: responseValue,
        sampleSize: responseSampleSize,
        source: "completed_first_confirmations" as const,
        percentile: "p50" as const,
        windowDays: responseWindowDays,
        latestObservationAt,
        maxStalenessDays: responseMaxStalenessDays,
      }
    : null;

  return { generatedAt, readyPharmacyCount, typicalResponse };
}

/**
 * Reads the fixed-shape, aggregate-only RPC through the anonymous public boundary.
 * Any transport, schema, privacy, approval, sample or freshness failure returns no
 * public signal; the storefront never substitutes a build-time or invented value.
 */
export const getPublicTrustMetrics = cache(async function getPublicTrustMetrics(): Promise<PublicTrustMetrics | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!baseUrl || !publishableKey) return null;

  let endpoint: URL;
  try {
    endpoint = new URL("/rest/v1/rpc/dawanear_public_trust_metrics", baseUrl);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co")) return null;
  } catch {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLIC_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parsePublicTrustMetrics(await response.json());
  } catch {
    return null;
  }
});

export const __test = { parsePublicTrustMetrics };

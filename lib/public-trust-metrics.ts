import { cache } from "react";
import {
  serverD1CatalogueConfigured,
  withServerD1Database,
} from "./d1-catalogue-server.ts";
import { allRows, firstRow, type D1Row } from "../db/index.ts";

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
  if (serverD1CatalogueConfigured) {
    const payload = await withServerD1Database(async (database) => {
      const generatedAt = new Date().toISOString();
      const today = generatedAt.slice(0, 10);
      const approvals = await allRows<D1Row>(database, `
        SELECT metric_key FROM med250_public_metric_approvals
        WHERE approved = 1 AND approved_at <= ? AND expires_at > ?
      `, [generatedAt, generatedAt]);
      const approved = new Set(approvals.map((row) => row.metric_key).filter((value): value is string => typeof value === "string"));
      const ready = await firstRow<D1Row>(database, `
        SELECT count(*) AS count FROM med250_pharmacies pharmacy
        WHERE pharmacy.marketplace_approved = 1 AND pharmacy.dispatch_enabled = 1
          AND pharmacy.licence_status = 'current' AND pharmacy.licence_expires_on >= ?
          AND pharmacy.latitude IS NOT NULL AND pharmacy.longitude IS NOT NULL
          AND EXISTS (SELECT 1 FROM med250_pharmacy_contacts contact
            WHERE contact.pharmacy_id = pharmacy.id AND contact.channel = 'whatsapp'
              AND contact.verified_at IS NOT NULL AND contact.active = 1 AND contact.dispatch_enabled = 1)
      `, [today]);
      const readyCount = Number(ready?.count ?? 0);
      const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
      const responses = await allRows<D1Row>(database, `
        SELECT recipient.request_id, min(recipient.dispatched_at) AS first_dispatch_at,
          min(recipient.responded_at) AS first_response_at
        FROM med250_request_recipients recipient
        JOIN med250_client_requests request ON request.id = recipient.request_id
        WHERE recipient.dispatched_at >= ? AND recipient.dispatched_at <= ?
          AND recipient.responded_at IS NOT NULL AND recipient.response_status IS NOT NULL
          AND recipient.responded_at >= recipient.dispatched_at
          AND request.status IN ('dispatched', 'completed')
        GROUP BY recipient.request_id
      `, [windowStart, generatedAt]);
      const validResponses = responses.flatMap((row) => {
        const dispatched = typeof row.first_dispatch_at === "string" ? Date.parse(row.first_dispatch_at) : Number.NaN;
        const responded = typeof row.first_response_at === "string" ? Date.parse(row.first_response_at) : Number.NaN;
        return Number.isFinite(dispatched) && Number.isFinite(responded) && responded >= dispatched && responded <= dispatched + 86_400_000
          ? [{ responseMs: responded - dispatched, respondedAt: new Date(responded).toISOString() }]
          : [];
      }).sort((left, right) => left.responseMs - right.responseMs);
      const daySpread = new Set(validResponses.map((entry) => entry.respondedAt.slice(0, 10))).size;
      const latest = validResponses.map((entry) => entry.respondedAt).sort().at(-1) ?? null;
      const fresh = latest !== null && Date.parse(latest) >= Date.now() - 14 * 24 * 60 * 60_000;
      const responsePublished = approved.has("typical_response_time") && validResponses.length >= 30 && daySpread >= 3 && fresh;
      const median = responsePublished ? validResponses[Math.floor((validResponses.length - 1) / 2)]?.responseMs ?? null : null;
      const readyPublished = approved.has("ready_pharmacy_count") && Number.isSafeInteger(readyCount) && readyCount > 0;
      return {
        schema_version: 1,
        generated_at: generatedAt,
        ready_pharmacy_count: {
          value: readyPublished ? readyCount : null,
          source: "governed_dispatch_eligibility",
          measurement_type: "current_population",
          sample_size: readyPublished ? readyCount : null,
          as_of: generatedAt,
        },
        typical_response_minutes: {
          value: median === null ? null : Math.max(1, Math.round(median / 60_000)),
          source: "completed_first_confirmations",
          percentile: "p50",
          sample_size: responsePublished ? validResponses.length : null,
          window_days: 90,
          latest_observation_at: responsePublished ? latest : null,
          max_staleness_days: 14,
        },
        privacy: {
          aggregate_only: true,
          contains_pharmacy_identity: false,
          contains_customer_or_health_data: false,
          suppressed_sample_counts_hidden: true,
        },
      };
    });
    return parsePublicTrustMetrics(payload);
  }

  return null;
});

export const __test = { parsePublicTrustMetrics };

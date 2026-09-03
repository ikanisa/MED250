import { firstRow, type D1Row } from "../../db/index.ts";
import { constantTimeEqualHex, sha256Hex } from "./secure-token.ts";
import { d1Database, healthProbeToken } from "./runtime-env.ts";
import { BUSINESS_CONTENT } from "./whatsapp-content.ts";

const HEALTH_PATH = "/api/internal/health";
const HEALTH_CONTRACT = "med250-worker-d1-health-v1";
const BEARER_TOKEN = /^Bearer ([\x21-\x7e]{32,256})$/i;

type OperationalHealthSnapshot = Record<string, unknown> & {
  contract_version: typeof HEALTH_CONTRACT;
  generated_at: string;
  status: "healthy" | "degraded" | "critical";
  privacy: Record<string, unknown> & {
    aggregate_only: true;
    contains_identifiers: false;
    contains_phone_numbers: false;
    contains_coordinates: false;
    contains_health_or_prescription_data: false;
  };
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validatedSnapshot(value: unknown): OperationalHealthSnapshot {
  const snapshot = object(value);
  const privacy = object(snapshot?.privacy);
  const status = snapshot?.status;
  const generatedAt = snapshot?.generated_at;
  if (
    snapshot?.contract_version !== HEALTH_CONTRACT
    || !["healthy", "degraded", "critical"].includes(typeof status === "string" ? status : "")
    || typeof generatedAt !== "string"
    || !Number.isFinite(Date.parse(generatedAt))
    || privacy?.aggregate_only !== true
    || privacy?.contains_identifiers !== false
    || privacy?.contains_phone_numbers !== false
    || privacy?.contains_coordinates !== false
    || privacy?.contains_health_or_prescription_data !== false
  ) throw new Error("Operational health snapshot failed its private aggregate contract.");
  return snapshot as OperationalHealthSnapshot;
}

function integer(row: D1Row | null, key: string): number {
  const parsed = Number(row?.[key]);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Operational health field ${key} is invalid.`);
  return parsed;
}

function text(row: D1Row | null, key: string): string {
  const value = row?.[key];
  if (typeof value !== "string" || !value) throw new Error(`Operational health field ${key} is invalid.`);
  return value;
}

export class OperationalHealthRepository {
  constructor(private readonly database: D1Database) {}

  private async count(sql: string, bindings: unknown[] = []): Promise<number> {
    return integer(await firstRow<D1Row>(this.database, `SELECT count(*) AS count FROM ${sql}`, bindings), "count");
  }

  async snapshot(): Promise<OperationalHealthSnapshot> {
    const now = Date.now();
    const at = new Date(now).toISOString();
    const fiveMinutesAgo = new Date(now - 5 * 60_000).toISOString();
    const tenMinutesAgo = new Date(now - 10 * 60_000).toISOString();
    const fifteenMinutesAgo = new Date(now - 15 * 60_000).toISOString();
    const thirtyMinutesAgo = new Date(now - 30 * 60_000).toISOString();
    const dayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
    const today = at.slice(0, 10);
    const contract = await firstRow<D1Row>(this.database, `
      SELECT expected_migration, expected_applied_count FROM med250_runtime_contract WHERE contract_key = 'worker_runtime'
    `);
    const migrations = await firstRow<D1Row>(this.database, `
      SELECT count(*) AS applied_count, coalesce(replace(max(name), '.sql', ''), '') AS current_version FROM d1_migrations
    `);
    const expectedMigration = text(contract, "expected_migration");
    const expectedAppliedCount = integer(contract, "expected_applied_count");
    const appliedCount = integer(migrations, "applied_count");
    const currentMigration = text(migrations, "current_version");
    const migrationsCurrent = currentMigration === expectedMigration && appliedCount === expectedAppliedCount;

    const [
      currentPharmacies, gpsReady, dispatchReady, verifiedLogin, verifiedDispatch,
      resolvedNumbers, ambiguousNumbers, retiredNumbers, clients, pharmacyActors, savedLocations,
      pending, claimed, enqueued, sending, retry, providerUnknown, failed, failed24h, deadLetter,
      stalePending, staleClaimed, staleEnqueued, staleSending, callbackFailures24h,
      staleInbound, activeOrders, waitingOrders, expiredRequestMedia, expiredPrescriptionMedia,
      staleRequestMedia, stalePrescriptionMedia, expiredGrants, dashboardSnapshots,
      dashboardRows, pharmacyReceipts, catalogueReceipts, catalogueMediaReceipts,
      approvedProductImages, activeRightsVerifiedImages, rightsPendingImages, approvedWithoutRights,
    ] = await Promise.all([
      this.count("med250_pharmacies WHERE licence_status = 'current'"),
      this.count("med250_pharmacies WHERE licence_status = 'current' AND latitude IS NOT NULL AND longitude IS NOT NULL"),
      this.count(`med250_pharmacies pharmacy WHERE licence_status = 'current' AND licence_expires_on >= ?
        AND marketplace_approved = 1 AND dispatch_enabled = 1 AND geocode_status='verified'
        AND latitude BETWEEN -3 AND -0.8 AND longitude BETWEEN 28.7 AND 30.9
        AND EXISTS (SELECT 1 FROM med250_pharmacy_contacts contact WHERE contact.pharmacy_id = pharmacy.id
          AND contact.channel = 'whatsapp' AND contact.verified_at IS NOT NULL AND contact.active = 1 AND contact.dispatch_enabled = 1
          AND (contact.messaging_opt_in_at IS NOT NULL OR EXISTS (
            SELECT 1 FROM med250_partner_initial_permissions permission
            WHERE permission.contact_id=contact.id AND permission.pharmacy_id=pharmacy.id AND permission.e164=contact.e164
              AND permission.revoked_at IS NULL AND permission.claimed_request_id IS NULL
              AND (SELECT count(*) FROM med250_twilio_content_registry WHERE definition_key IN (?,?)
                AND state='ready' AND approval_status='approved')=2
          ))
          AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=contact.e164 AND a.whatsapp_opted_out_at IS NOT NULL))`,
        [today,`business:${BUSINESS_CONTENT.image_initial.content.friendly_name}`,`business:${BUSINESS_CONTENT.web_initial.content.friendly_name}`]),
      this.count("med250_pharmacy_contacts WHERE channel = 'whatsapp' AND verified_at IS NOT NULL AND active = 1 AND login_enabled = 1"),
      this.count(`med250_pharmacy_contacts c WHERE channel='whatsapp' AND verified_at IS NOT NULL AND active=1 AND dispatch_enabled=1
        AND messaging_opt_in_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM med250_actors a WHERE a.e164=c.e164 AND a.whatsapp_opted_out_at IS NOT NULL)`),
      this.count("med250_known_pharmacy_numbers WHERE resolution_status = 'resolved'"),
      this.count("med250_known_pharmacy_numbers WHERE resolution_status = 'ambiguous'"),
      this.count("med250_known_pharmacy_numbers WHERE resolution_status = 'retired'"),
      this.count("med250_actors WHERE actor_type = 'client'"),
      this.count("med250_actors WHERE actor_type = 'pharmacy'"),
      this.count("med250_client_locations WHERE is_current = 1"),
      this.count("med250_dispatch_outbox WHERE status = 'pending'"),
      this.count("med250_dispatch_outbox WHERE status = 'claimed'"),
      this.count("med250_dispatch_outbox WHERE status = 'enqueued'"),
      this.count("med250_dispatch_outbox WHERE status = 'sending'"),
      this.count("med250_dispatch_outbox WHERE status = 'retry'"),
      this.count("med250_dispatch_outbox WHERE status = 'provider_send_unknown'"),
      this.count("med250_dispatch_outbox WHERE status = 'failed'"),
      this.count("med250_dispatch_outbox WHERE status = 'failed' AND failed_at >= ?", [dayAgo]),
      this.count("med250_dispatch_outbox WHERE status = 'dead_letter'"),
      this.count("med250_dispatch_outbox WHERE status IN ('pending', 'retry') AND available_at < ?", [fiveMinutesAgo]),
      this.count("med250_dispatch_outbox WHERE status = 'claimed' AND claim_expires_at < ?", [at]),
      this.count("med250_dispatch_outbox WHERE status = 'enqueued' AND available_at < ?", [tenMinutesAgo]),
      this.count("med250_dispatch_outbox WHERE status = 'sending' AND send_started_at < ?", [tenMinutesAgo]),
      this.count("med250_provider_delivery_events WHERE error_code IS NOT NULL AND received_at >= ?", [dayAgo]),
      this.count("med250_inbound_events WHERE processed_at IS NULL AND received_at < ?", [tenMinutesAgo]),
      this.count("med250_client_requests WHERE status IN ('awaiting_location', 'awaiting_location_choice', 'processing_media', 'ready', 'dispatched', 'selected')"),
      this.count(`med250_client_requests request WHERE status = 'dispatched' AND broadcast_at < ?
        AND NOT EXISTS (SELECT 1 FROM med250_pharmacy_responses response
          WHERE response.request_id = request.id AND response.response_status = 'can_fulfil')`, [thirtyMinutesAgo]),
      this.count("med250_request_media WHERE processing_status = 'ready' AND retention_expires_at < ? AND deleted_at IS NULL", [at]),
      this.count("med250_web_prescription_media WHERE processing_status = 'ready' AND retention_expires_at < ? AND deleted_at IS NULL", [at]),
      this.count("med250_request_media WHERE processing_status = 'processing' AND created_at < ?", [fifteenMinutesAgo]),
      this.count("med250_web_prescription_media WHERE processing_status = 'uploading' AND created_at < ?", [fifteenMinutesAgo]),
      this.count("med250_media_access_grants WHERE expires_at < ? AND revoked_at IS NULL", [at]),
      this.count("med250_dashboard_recovery_imports"),
      integer(await firstRow<D1Row>(this.database, "SELECT coalesce(sum(row_count), 0) AS count FROM med250_dashboard_recovery_imports"), "count"),
      this.count("med250_pharmacy_registry_import_receipts"),
      this.count("med250_catalogue_import_receipts"),
      this.count("med250_catalogue_media_recovery_receipts"),
      this.count("med250_product_images WHERE approved = 1"),
      this.count(`med250_product_images image WHERE image.approved = 1 AND image.rights_verified = 1
        AND EXISTS (SELECT 1 FROM med250_media_rights_policies policy WHERE policy.id = image.rights_policy_id
          AND policy.status = 'active' AND policy.effective_at <= ?
          AND (policy.expires_at IS NULL OR policy.expires_at > ?))`, [at, at]),
      this.count("med250_product_images WHERE rights_verified = 0"),
      this.count("med250_product_images WHERE approved = 1 AND rights_verified = 0"),
    ]);
    const initialPermissions = await firstRow<D1Row>(this.database, `SELECT count(*) AS recorded,
      coalesce(sum(claimed_request_id IS NOT NULL),0) AS claimed,
      coalesce(sum(revoked_at IS NOT NULL),0) AS revoked,
      coalesce(sum(claimed_request_id IS NULL AND revoked_at IS NULL),0) AS unused
      FROM med250_partner_initial_permissions`);
    const staleWork = stalePending + staleClaimed + staleEnqueued + staleSending;
    const expiredNotDeleted = expiredRequestMedia + expiredPrescriptionMedia;
    const staleProcessing = staleRequestMedia + stalePrescriptionMedia;
    const critical = !migrationsCurrent || dispatchReady === 0 || verifiedLogin === 0
      || providerUnknown > 0 || deadLetter > 0 || staleWork > 0 || staleInbound > 0
      || expiredNotDeleted > 0 || staleProcessing > 0 || approvedWithoutRights > 0;
    const degraded = failed24h > 0 || retry > 0 || callbackFailures24h > 0 || waitingOrders > 0 || expiredGrants > 0;
    return validatedSnapshot({
      contract_version: HEALTH_CONTRACT, generated_at: at, status: critical ? "critical" : degraded ? "degraded" : "healthy",
      privacy: { aggregate_only: true, contains_identifiers: false, contains_phone_numbers: false, contains_coordinates: false, contains_health_or_prescription_data: false },
      database: { expected_migration: expectedMigration, current_migration: currentMigration, applied_migration_count: appliedCount, baseline_checksums_valid: migrationsCurrent, migrations_current: migrationsCurrent },
      pharmacies: { current: currentPharmacies, gps_ready: gpsReady, dispatch_ready: dispatchReady, verified_login_contacts: verifiedLogin, verified_dispatch_contacts: verifiedDispatch, known_numbers_resolved: resolvedNumbers, known_numbers_ambiguous: ambiguousNumbers, known_numbers_retired: retiredNumbers },
      users: { clients, pharmacy_actors: pharmacyActors, saved_current_locations: savedLocations },
      partner_permissions: { basis: 'owner_attested_initial_request',
        recorded: integer(initialPermissions,'recorded'), claimed: integer(initialPermissions,'claimed'),
        revoked: integer(initialPermissions,'revoked'), unused: integer(initialPermissions,'unused'),
        recurring_opted_in_contacts: verifiedDispatch },
      dispatch: { pending, claimed, enqueued, sending, retry, provider_send_unknown: providerUnknown, failed, failed_24h: failed24h, dead_letter: deadLetter, stale_work: staleWork, provider_callback_failures_24h: callbackFailures24h },
      inbound: { stale_unprocessed: staleInbound },
      orders: { active: activeOrders, waiting_without_confirmation_over_30m: waitingOrders },
      private_media: { expired_not_deleted: expiredNotDeleted, stale_processing: staleProcessing, expired_active_grants: expiredGrants },
      catalogue_media: {
        approved_images: approvedProductImages,
        active_rights_verified_images: activeRightsVerifiedImages,
        rights_pending_images: rightsPendingImages,
        approved_without_rights: approvedWithoutRights,
      },
      recovery: { dashboard_snapshots: dashboardSnapshots, dashboard_rows: dashboardRows, pharmacy_registry_receipts: pharmacyReceipts, catalogue_receipts: catalogueReceipts, catalogue_media_receipts: catalogueMediaReceipts },
    });
  }
}

async function authorized(request: Request, expectedToken: string): Promise<boolean> {
  const match = BEARER_TOKEN.exec(request.headers.get("authorization") ?? "");
  const candidate = match?.[1] ?? "med250-missing-health-probe-token";
  const [candidateHash, expectedHash] = await Promise.all([sha256Hex(candidate), sha256Hex(expectedToken)]);
  return match !== null && constantTimeEqualHex(candidateHash, expectedHash);
}

function healthJson(payload: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(payload, { status, headers: {
    "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", Vary: "Authorization",
    "X-Robots-Tag": "noindex, nofollow", ...headers,
  } });
}

export async function operationalHealthApiResponse(
  request: Request,
  repository: Pick<OperationalHealthRepository, "snapshot">,
  expectedToken: string,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== HEALTH_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return healthJson({ error: "method_not_allowed" }, 405, { Allow: "GET, HEAD" });
  if (!(await authorized(request, expectedToken))) return healthJson({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="med250-operational-health"' });
  const snapshot = await repository.snapshot();
  const headers = new Headers({
    "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", Vary: "Authorization",
    "X-MED250-Health": snapshot.status, "X-Robots-Tag": "noindex, nofollow",
  });
  return new Response(request.method === "HEAD" ? null : JSON.stringify(snapshot), { status: 200, headers });
}

export async function operationalHealthResponse(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== HEALTH_PATH) return null;
  return operationalHealthApiResponse(request, new OperationalHealthRepository(d1Database(env)), healthProbeToken(env));
}

export const __test = { validatedSnapshot };

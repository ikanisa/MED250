import { allRows, atomicBatch, firstRow, newId, nowIso, runStatement, type D1Row } from "../../db/index.ts";
import { d1Database, privateMediaBucket } from "./runtime-env.ts";

export type PrivateMediaCleanupJob = {
  id: string;
  claimToken: string;
  sourceKind: "whatsapp_request" | "web_prescription";
  r2Key: string;
  attemptCount: number;
};

function requiredString(row: D1Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Cleanup field ${key} is invalid.`);
  return value;
}

function requiredNumber(row: D1Row, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Cleanup field ${key} is invalid.`);
  return value;
}

function changes(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === "number" ? result.meta.changes : 0;
}

export class MediaRetentionRepository {
  constructor(private readonly database: D1Database) {}

  async enqueueDue(limit = 100): Promise<number> {
    const bounded = Math.max(1, Math.min(limit, 500));
    const at = nowIso();
    const candidates = await allRows<D1Row>(this.database, `
      SELECT 'whatsapp_request' AS source_kind, media.id AS source_id, media.r2_key, media.retention_expires_at AS due_at
      FROM med250_request_media media
      JOIN med250_client_requests request ON request.id = media.request_id
      WHERE media.processing_status = 'ready' AND media.deleted_at IS NULL
        AND media.r2_key IS NOT NULL AND media.retention_expires_at <= ?
        AND (request.expires_at <= ? OR request.status IN ('cancelled', 'expired', 'completed'))
      UNION ALL
      SELECT 'web_prescription', media.id, media.r2_key, media.retention_expires_at
      FROM med250_web_prescription_media media
      WHERE media.processing_status = 'ready' AND media.deleted_at IS NULL
        AND media.retention_expires_at <= ? AND (
          media.attached_request_id IS NULL OR EXISTS (
            SELECT 1 FROM med250_client_requests request
            WHERE request.id = media.attached_request_id
              AND (request.expires_at <= ? OR request.status IN ('cancelled', 'expired', 'completed'))
          )
        )
      ORDER BY due_at, source_kind, source_id LIMIT ?
    `, [at, at, at, at, bounded]);
    if (!candidates.length) return 0;
    const results = await atomicBatch(this.database, candidates.map((candidate) => this.database.prepare(`
      INSERT OR IGNORE INTO med250_private_media_cleanup_jobs (
        id, source_kind, source_id, r2_key, status, attempt_count, max_attempts,
        available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, 5, ?, ?, ?)
    `).bind(newId(), requiredString(candidate, "source_kind"), requiredString(candidate, "source_id"),
      requiredString(candidate, "r2_key"), at, at, at)));
    return results.reduce((count, result) => count + changes(result), 0);
  }

  async claim(claimToken: string, limit = 10): Promise<PrivateMediaCleanupJob[]> {
    const bounded = Math.max(1, Math.min(limit, 100));
    const at = nowIso();
    const expires = new Date(Date.now() + 120_000).toISOString();
    const candidates = await allRows<D1Row>(this.database, `
      SELECT id FROM med250_private_media_cleanup_jobs
      WHERE (status IN ('pending', 'retry') OR (status = 'claimed' AND claim_expires_at < ?))
        AND available_at <= ? AND attempt_count < max_attempts
      ORDER BY available_at, created_at, id LIMIT ?
    `, [at, at, bounded]);
    if (!candidates.length) return [];
    await atomicBatch(this.database, candidates.map((candidate) => this.database.prepare(`
      UPDATE med250_private_media_cleanup_jobs
      SET status = 'claimed', claim_token = ?, claimed_at = ?, claim_expires_at = ?,
        attempt_count = attempt_count + 1, updated_at = ?
      WHERE id = ? AND (status IN ('pending', 'retry') OR (status = 'claimed' AND claim_expires_at < ?))
        AND available_at <= ? AND attempt_count < max_attempts
    `).bind(claimToken, at, expires, at, requiredString(candidate, "id"), at, at)));
    const rows = await allRows<D1Row>(this.database, `
      SELECT id, claim_token, source_kind, r2_key, attempt_count
      FROM med250_private_media_cleanup_jobs WHERE claim_token = ? AND status = 'claimed'
      ORDER BY claimed_at, id
    `, [claimToken]);
    return rows.map((row) => {
      const sourceKind = requiredString(row, "source_kind");
      if (sourceKind !== "whatsapp_request" && sourceKind !== "web_prescription") {
        throw new Error("Cleanup source kind is invalid.");
      }
      return {
        id: requiredString(row, "id"), claimToken: requiredString(row, "claim_token"), sourceKind,
        r2Key: requiredString(row, "r2_key"), attemptCount: requiredNumber(row, "attempt_count"),
      };
    });
  }

  async complete(job: PrivateMediaCleanupJob): Promise<boolean> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT source_id, r2_key FROM med250_private_media_cleanup_jobs
      WHERE id = ? AND status = 'claimed' AND claim_token = ?
    `, [job.id, job.claimToken]);
    if (!row) return false;
    const at = nowIso();
    const sourceId = requiredString(row, "source_id");
    const sourceTable = job.sourceKind === "whatsapp_request" ? "med250_request_media" : "med250_web_prescription_media";
    const sourceRequestColumn = job.sourceKind === "whatsapp_request" ? "request_id" : "attached_request_id";
    const request = await firstRow<D1Row>(this.database,
      `SELECT ${sourceRequestColumn} AS request_id FROM ${sourceTable} WHERE id = ? AND r2_key = ? AND deleted_at IS NULL`,
      [sourceId, job.r2Key]);
    if (!request) return false;
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE ${sourceTable} SET processing_status = 'deleted', deleted_at = coalesce(deleted_at, ?), updated_at = ?
        WHERE id = ? AND r2_key = ? AND deleted_at IS NULL
      `).bind(at, at, sourceId, job.r2Key),
      this.database.prepare(`
        UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?)
        WHERE r2_key = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM ${sourceTable} source WHERE source.id = ? AND source.deleted_at = ?)
      `).bind(at, job.r2Key, sourceId, at),
      this.database.prepare(`
        UPDATE med250_private_media_cleanup_jobs
        SET status = 'deleted', claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
          completed_at = ?, last_error_code = NULL, updated_at = ?
        WHERE id = ? AND claim_token = ?
          AND EXISTS (SELECT 1 FROM ${sourceTable} source WHERE source.id = ? AND source.deleted_at = ?)
      `).bind(at, at, job.id, job.claimToken, sourceId, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
        SELECT 'private_media_retention_deleted', ?, json_object('source_kind', ?, 'attempt', ?), ?
        WHERE EXISTS (SELECT 1 FROM med250_private_media_cleanup_jobs cleanup WHERE cleanup.id = ? AND cleanup.status = 'deleted')
      `).bind(request.request_id ?? null, job.sourceKind, job.attemptCount, at, job.id),
    ]);
    return changes(results[0]) === 1 && changes(results[2]) === 1;
  }

  async fail(job: PrivateMediaCleanupJob, errorCode: string): Promise<boolean> {
    const resultingStatus = job.attemptCount < 5 ? "retry" : "failed";
    const at = nowIso();
    const delaySeconds = Math.min(3_600, 60 * (2 ** Math.max(0, job.attemptCount - 1)));
    const availableAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
    const result = await runStatement(this.database, `
      UPDATE med250_private_media_cleanup_jobs
      SET status = ?, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
        available_at = CASE WHEN ? = 'retry' THEN ? ELSE available_at END,
        last_error_code = ?, updated_at = ?
      WHERE id = ? AND status = 'claimed' AND claim_token = ?
    `, [resultingStatus, resultingStatus, availableAt, errorCode.trim().slice(0, 120) || "r2_delete_failed", at, job.id, job.claimToken]);
    return changes(result) === 1 && resultingStatus === "retry";
  }
}

function cleanupErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return `r2_delete_${name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "failed"}`;
}

export async function processPrivateMediaRetention(
  repository: MediaRetentionRepository,
  bucket: Pick<R2Bucket, "delete" | "head">,
  limit = 10,
): Promise<{ enqueued: number; claimed: number; deleted: number; failed: number }> {
  const enqueued = await repository.enqueueDue(Math.max(limit, 25));
  const jobs = await repository.claim(crypto.randomUUID(), limit);
  let deleted = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await bucket.delete(job.r2Key);
      if (await bucket.head(job.r2Key)) throw new Error("R2DeletionNotFinal");
      if (!(await repository.complete(job))) throw new Error("CleanupReceiptRejected");
      deleted += 1;
    } catch (error) {
      failed += 1;
      await repository.fail(job, cleanupErrorCode(error));
    }
  }
  return { enqueued, claimed: jobs.length, deleted, failed };
}

export async function sweepPrivateMediaRetention(
  env: Env,
): Promise<{ enqueued: number; claimed: number; deleted: number; failed: number }> {
  const receipt = await processPrivateMediaRetention(
    new MediaRetentionRepository(d1Database(env)),
    privateMediaBucket(env),
  );
  console.log(JSON.stringify({ event: "private_media_retention_swept", ...receipt }));
  return receipt;
}

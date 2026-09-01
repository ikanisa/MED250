import {
  allRows,
  atomicBatch,
  firstRow,
  newId,
  normalizedE164,
  nowIso,
  runStatement,
  type D1Row,
} from "../../db/index.ts";

export type AdminRole = "super_admin" | "operations_admin" | "catalogue_reviewer";

export type AdminPrincipal = {
  id: string;
  e164: string;
  displayName: string;
  role: AdminRole;
  status: "active" | "suspended";
  otpAuthEnabled: boolean;
  lastLoginAt: string | null;
};

export type AdminSessionReceipt = AdminPrincipal & {
  sessionId: string;
  csrfHashHex: string;
  expiresAt: string;
  absoluteExpiresAt: string;
};

export type AdminOtpVerification = {
  accepted: boolean;
  reason: string;
  sessionId: string | null;
  expiresAt: string | null;
  principal: AdminPrincipal | null;
};

const HEX_64 = /^[0-9a-f]{64}$/;
const VALID_ROLES = new Set<AdminRole>(["super_admin", "operations_admin", "catalogue_reviewer"]);

function field(row: D1Row, key: string): unknown {
  return Reflect.get(row, key);
}

function stringField(row: D1Row, key: string): string {
  const value = field(row, key);
  if (typeof value !== "string" || !value) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function nullableStringField(row: D1Row, key: string): string | null {
  const value = field(row, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function timestampField(row: D1Row, key: string): string {
  const value = stringField(row, key);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Database field ${key} is invalid.`);
  return new Date(value).toISOString();
}

function nullableTimestampField(row: D1Row, key: string): string | null {
  return field(row, key) === null || field(row, key) === undefined ? null : timestampField(row, key);
}

function booleanField(row: D1Row, key: string): boolean {
  const value = field(row, key);
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new Error(`Database field ${key} is invalid.`);
}

function numberField(row: D1Row, key: string): number {
  const value = Number(field(row, key));
  if (!Number.isFinite(value)) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function roleField(row: D1Row): AdminRole {
  const role = stringField(row, "role") as AdminRole;
  if (!VALID_ROLES.has(role)) throw new Error("Database admin role is invalid.");
  return role;
}

function principalFromRow(row: D1Row): AdminPrincipal {
  const status = stringField(row, "status");
  if (status !== "active" && status !== "suspended") throw new Error("Database admin status is invalid.");
  return {
    id: stringField(row, "principal_id"),
    e164: stringField(row, "e164"),
    displayName: stringField(row, "display_name"),
    role: roleField(row),
    status,
    otpAuthEnabled: booleanField(row, "otp_auth_enabled"),
    lastLoginAt: nullableTimestampField(row, "last_login_at"),
  };
}

function validSessionExpiry(expiresAt: string, absoluteExpiresAt: string): void {
  const now = Date.now();
  const expires = Date.parse(expiresAt);
  const absolute = Date.parse(absoluteExpiresAt);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 13 * 60 * 60_000) {
    throw new Error("admin session expiry is invalid");
  }
  if (!Number.isFinite(absolute) || absolute < expires || absolute > now + 13 * 60 * 60_000) {
    throw new Error("admin absolute session expiry is invalid");
  }
}

function rejected(reason: string): AdminOtpVerification {
  return { accepted: false, reason, sessionId: null, expiresAt: null, principal: null };
}

export class AdminRepository {
  constructor(private readonly database: D1Database) {}

  async findActivePrincipalByE164(e164: string): Promise<AdminPrincipal | null> {
    const normalized = normalizedE164(e164);
    const row = await firstRow<D1Row>(this.database, `
      SELECT id AS principal_id, e164, display_name, role, status, otp_auth_enabled, last_login_at
      FROM med250_admin_principals
      WHERE e164 = ? AND status = 'active' AND otp_auth_enabled = 1
      LIMIT 1
    `, [normalized]);
    return row ? principalFromRow(row) : null;
  }

  async recordUnknownLogin(e164HashHex: string, requestIpHashHex: string): Promise<void> {
    if (!HEX_64.test(e164HashHex) || !HEX_64.test(requestIpHashHex)) {
      throw new Error("admin authentication fingerprint is invalid");
    }
    const now = Date.now();
    const rate = await firstRow<D1Row>(this.database, `
      SELECT
        sum(CASE WHEN e164_hash = ? AND created_at >= ? THEN 1 ELSE 0 END) AS phone_hour,
        sum(CASE WHEN request_ip_hash = ? AND created_at >= ? THEN 1 ELSE 0 END) AS source_five_minutes,
        sum(CASE WHEN request_ip_hash = ? AND created_at >= ? THEN 1 ELSE 0 END) AS source_hour,
        sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS global_minute
      FROM med250_admin_auth_rate_events
    `, [
      e164HashHex, new Date(now - 3_600_000).toISOString(),
      requestIpHashHex, new Date(now - 300_000).toISOString(),
      requestIpHashHex, new Date(now - 3_600_000).toISOString(),
      new Date(now - 60_000).toISOString(),
    ]);
    if (Number(rate?.phone_hour ?? 0) >= 5
      || Number(rate?.source_five_minutes ?? 0) >= 10
      || Number(rate?.source_hour ?? 0) >= 30
      || Number(rate?.global_minute ?? 0) >= 60) {
      throw new Error("otp_source_rate_limit");
    }
    await runStatement(this.database, `
      INSERT INTO med250_admin_auth_rate_events (event_type, e164_hash, request_ip_hash, created_at)
      VALUES ('unknown_admin_login', ?, ?, ?)
    `, [e164HashHex, requestIpHashHex, nowIso()]);
  }

  async issueOtp(input: {
    challengeId: string;
    principalId: string;
    e164: string;
    codeHashHex: string;
    requestIpHashHex: string;
    ciphertext: string;
    nonce: string;
    expiresAt: string;
  }): Promise<{ challengeId: string; expiresAt: string }> {
    const normalized = normalizedE164(input.e164);
    if (!HEX_64.test(input.codeHashHex) || !HEX_64.test(input.requestIpHashHex)) {
      throw new Error("admin otp request is invalid");
    }
    const expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() + 180_000 || expiry > Date.now() + 600_000) {
      throw new Error("admin otp expiry is invalid");
    }
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(input.ciphertext) || !/^[A-Za-z0-9_-]{16,64}$/.test(input.nonce)) {
      throw new Error("admin otp encrypted payload is invalid");
    }
    const principal = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_admin_principals
      WHERE id = ? AND e164 = ? AND status = 'active' AND otp_auth_enabled = 1
    `, [input.principalId, normalized]);
    if (!principal) throw new Error("admin principal is not eligible for login");

    const now = Date.now();
    const rate = await firstRow<D1Row>(this.database, `
      SELECT
        sum(CASE WHEN e164 = ? AND created_at >= ? THEN 1 ELSE 0 END) AS phone_minute,
        sum(CASE WHEN e164 = ? AND created_at >= ? THEN 1 ELSE 0 END) AS phone_hour,
        sum(CASE WHEN request_ip_hash = ? AND created_at >= ? THEN 1 ELSE 0 END) AS source_five_minutes,
        sum(CASE WHEN request_ip_hash = ? AND created_at >= ? THEN 1 ELSE 0 END) AS source_hour,
        sum(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS global_minute
      FROM med250_admin_otp_challenges
    `, [
      normalized, new Date(now - 60_000).toISOString(),
      normalized, new Date(now - 3_600_000).toISOString(),
      input.requestIpHashHex, new Date(now - 300_000).toISOString(),
      input.requestIpHashHex, new Date(now - 3_600_000).toISOString(),
      new Date(now - 60_000).toISOString(),
    ]);
    if (Number(rate?.phone_minute ?? 0) >= 1) throw new Error("otp_phone_minute_rate_limit");
    if (Number(rate?.phone_hour ?? 0) >= 5) throw new Error("otp_phone_hour_rate_limit");
    if (Number(rate?.source_five_minutes ?? 0) >= 10
      || Number(rate?.source_hour ?? 0) >= 30
      || Number(rate?.global_minute ?? 0) >= 60) {
      throw new Error("otp_source_rate_limit");
    }

    const createdAt = nowIso();
    const outboxId = newId();
    await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_dispatch_outbox
        SET status = 'failed', last_error_code = 'admin_otp_superseded',
            failed_at = coalesce(failed_at, ?), updated_at = ?
        WHERE admin_otp_challenge_id IN (
          SELECT id FROM med250_admin_otp_challenges
          WHERE principal_id = ? AND consumed_at IS NULL
        ) AND status IN ('pending', 'claimed', 'enqueued', 'retry')
      `).bind(createdAt, createdAt, input.principalId),
      this.database.prepare(`
        UPDATE med250_admin_otp_challenges
        SET consumed_at = coalesce(consumed_at, ?)
        WHERE principal_id = ? AND consumed_at IS NULL
      `).bind(createdAt, input.principalId),
      this.database.prepare(`
        INSERT INTO med250_admin_otp_challenges (
          id, principal_id, e164, code_hash, request_ip_hash, encrypted_code,
          encryption_nonce, expires_at, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
      `).bind(
        input.challengeId, input.principalId, normalized, input.codeHashHex,
        input.requestIpHashHex, input.ciphertext, input.nonce, input.expiresAt, createdAt,
      ),
      this.database.prepare(`
        INSERT INTO med250_dispatch_outbox (
          id, dedupe_key, kind, admin_otp_challenge_id, recipient_e164, payload,
          status, available_at, created_at, updated_at
        ) VALUES (?, ?, 'otp', ?, ?, ?, 'pending', ?, ?, ?)
      `).bind(
        outboxId, `admin-otp:${input.challengeId}`, input.challengeId, normalized,
        JSON.stringify({
          challenge_id: input.challengeId,
          actor_type: "admin",
          ciphertext: input.ciphertext,
          nonce: input.nonce,
        }),
        createdAt, createdAt, createdAt,
      ),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, outbox_id, details, created_at)
        VALUES ('admin_otp_queued', ?, ?, ?)
      `).bind(outboxId, JSON.stringify({ admin_principal_id: input.principalId }), createdAt),
    ]);
    return { challengeId: input.challengeId, expiresAt: new Date(input.expiresAt).toISOString() };
  }

  async verifyOtp(input: {
    challengeId: string;
    e164: string;
    codeHashHex: string;
    session: {
      tokenHashHex: string;
      csrfHashHex: string;
      requestIpHashHex: string;
      userAgentHashHex: string;
      expiresAt: string;
      absoluteExpiresAt: string;
    };
  }): Promise<AdminOtpVerification> {
    const normalized = normalizedE164(input.e164);
    if (!HEX_64.test(input.codeHashHex)
      || !HEX_64.test(input.session.tokenHashHex)
      || !HEX_64.test(input.session.csrfHashHex)
      || !HEX_64.test(input.session.requestIpHashHex)
      || !HEX_64.test(input.session.userAgentHashHex)) {
      throw new Error("admin otp verification is invalid");
    }
    validSessionExpiry(input.session.expiresAt, input.session.absoluteExpiresAt);
    const challenge = await firstRow<D1Row>(this.database, `
      SELECT challenge.*, principal.id AS principal_id, principal.e164,
        principal.display_name, principal.role, principal.status,
        principal.otp_auth_enabled, principal.last_login_at
      FROM med250_admin_otp_challenges challenge
      JOIN med250_admin_principals principal ON principal.id = challenge.principal_id
      WHERE challenge.id = ? AND challenge.e164 = ?
      LIMIT 1
    `, [input.challengeId, normalized]);
    if (!challenge) return rejected("invalid");
    if (nullableStringField(challenge, "consumed_at")) return rejected("used");
    const now = nowIso();
    if (stringField(challenge, "expires_at") <= now) {
      await runStatement(this.database, `
        UPDATE med250_admin_otp_challenges
        SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL
      `, [now, input.challengeId]);
      return rejected("expired");
    }
    if (stringField(challenge, "status") !== "active" || !booleanField(challenge, "otp_auth_enabled")) {
      await runStatement(this.database, `
        UPDATE med250_admin_otp_challenges
        SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL
      `, [now, input.challengeId]);
      return rejected("principal_disabled");
    }
    const attempts = numberField(challenge, "attempts");
    const maxAttempts = numberField(challenge, "max_attempts");
    if (attempts >= maxAttempts) return rejected("attempts_exhausted");
    if (stringField(challenge, "code_hash") !== input.codeHashHex) {
      await runStatement(this.database, `
        UPDATE med250_admin_otp_challenges
        SET attempts = attempts + 1,
            consumed_at = CASE WHEN attempts + 1 >= max_attempts THEN ? ELSE consumed_at END
        WHERE id = ? AND consumed_at IS NULL
      `, [now, input.challengeId]);
      return rejected("incorrect");
    }

    const principal = principalFromRow(challenge);
    const sessionId = newId();
    const statements = [
      this.database.prepare(`
        INSERT INTO med250_admin_otp_redemptions (challenge_id, principal_id, redeemed_at)
        VALUES (?, ?, ?)
      `).bind(input.challengeId, principal.id, now),
      this.database.prepare(`
        UPDATE med250_admin_otp_challenges
        SET attempts = attempts + 1, consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL AND code_hash = ?
      `).bind(now, input.challengeId, input.codeHashHex),
      this.database.prepare(`
        INSERT INTO med250_admin_sessions (
          id, principal_id, token_hash, csrf_hash, request_ip_hash, user_agent_hash,
          expires_at, absolute_expires_at, last_seen_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sessionId, principal.id, input.session.tokenHashHex, input.session.csrfHashHex,
        input.session.requestIpHashHex, input.session.userAgentHashHex,
        input.session.expiresAt, input.session.absoluteExpiresAt, now, now,
      ),
      this.database.prepare(`
        UPDATE med250_admin_principals
        SET last_login_at = ?, updated_at = ? WHERE id = ? AND status = 'active'
      `).bind(now, now, principal.id),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('admin_otp_verified', ?, ?)
      `).bind(JSON.stringify({ admin_principal_id: principal.id, role: principal.role }), now),
    ];
    try {
      await atomicBatch(this.database, statements);
    } catch (error) {
      const redeemed = await firstRow(this.database, `
        SELECT challenge_id FROM med250_admin_otp_redemptions WHERE challenge_id = ?
      `, [input.challengeId]);
      if (redeemed) return rejected("used");
      throw error;
    }
    return {
      accepted: true,
      reason: "accepted",
      sessionId,
      expiresAt: new Date(input.session.expiresAt).toISOString(),
      principal: { ...principal, lastLoginAt: now },
    };
  }

  async lookupSession(tokenHashHex: string): Promise<AdminSessionReceipt | null> {
    if (!HEX_64.test(tokenHashHex)) return null;
    const now = nowIso();
    const row = await firstRow<D1Row>(this.database, `
      SELECT session.id AS session_id, session.csrf_hash AS csrf_hash_hex,
        session.expires_at, session.absolute_expires_at, session.last_seen_at,
        principal.id AS principal_id, principal.e164, principal.display_name,
        principal.role, principal.status, principal.otp_auth_enabled, principal.last_login_at
      FROM med250_admin_sessions session
      JOIN med250_admin_principals principal ON principal.id = session.principal_id
      WHERE session.token_hash = ? AND session.revoked_at IS NULL
        AND session.expires_at > ? AND session.absolute_expires_at > ?
        AND principal.status = 'active' AND principal.otp_auth_enabled = 1
      LIMIT 1
    `, [tokenHashHex, now, now]);
    if (!row) return null;
    const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString();
    if (stringField(row, "last_seen_at") < fiveMinutesAgo) {
      await runStatement(this.database, `
        UPDATE med250_admin_sessions SET last_seen_at = ? WHERE id = ?
      `, [now, stringField(row, "session_id")]);
    }
    return {
      ...principalFromRow(row),
      sessionId: stringField(row, "session_id"),
      csrfHashHex: stringField(row, "csrf_hash_hex"),
      expiresAt: timestampField(row, "expires_at"),
      absoluteExpiresAt: timestampField(row, "absolute_expires_at"),
    };
  }

  async revokeSession(tokenHashHex: string): Promise<boolean> {
    if (!HEX_64.test(tokenHashHex)) return false;
    const result = await runStatement(this.database, `
      UPDATE med250_admin_sessions
      SET revoked_at = coalesce(revoked_at, ?)
      WHERE token_hash = ? AND revoked_at IS NULL
    `, [nowIso(), tokenHashHex]);
    return (result.meta.changes ?? 0) > 0;
  }

  async dashboard(): Promise<{
    generatedAt: string;
    catalogue: { active: number; orderable: number; pendingReview: number };
    pharmacies: { total: number; marketplaceApproved: number; dispatchReady: number; pendingContactChanges: number };
    requests: { open: number; created24h: number; selected24h: number };
    delivery: { pending: number; retrying: number; failed24h: number };
    access: { activeAdmins: number; activeSessions: number };
    recentAdminActivity: Array<{ eventType: string; createdAt: string }>;
  }> {
    const now = nowIso();
    const since24h = new Date(Date.now() - 86_400_000).toISOString();
    const summary = await firstRow<D1Row>(this.database, `
      SELECT
        (SELECT count(*) FROM med250_catalogue_products WHERE is_active = 1) AS catalogue_active,
        (SELECT count(*) FROM med250_catalogue_products WHERE is_active = 1 AND is_orderable = 1) AS catalogue_orderable,
        (SELECT count(*) FROM med250_catalogue_products WHERE publication_status IN ('research_candidate', 'catalogue_review')) AS catalogue_pending,
        (SELECT count(*) FROM med250_pharmacies) AS pharmacies_total,
        (SELECT count(*) FROM med250_pharmacies WHERE marketplace_approved = 1) AS pharmacies_approved,
        (SELECT count(*) FROM med250_pharmacies WHERE dispatch_enabled = 1) AS pharmacies_dispatch,
        (SELECT count(*) FROM med250_pharmacy_contact_change_requests WHERE status = 'pending') AS contact_pending,
        (SELECT count(*) FROM med250_client_requests WHERE status NOT IN ('cancelled', 'expired', 'completed')) AS requests_open,
        (SELECT count(*) FROM med250_client_requests WHERE created_at >= ?) AS requests_24h,
        (SELECT count(*) FROM med250_client_requests WHERE selected_at >= ?) AS selected_24h,
        (SELECT count(*) FROM med250_dispatch_outbox WHERE status IN ('pending', 'claimed', 'enqueued', 'sending')) AS outbox_pending,
        (SELECT count(*) FROM med250_dispatch_outbox WHERE status = 'retry') AS outbox_retry,
        (SELECT count(*) FROM med250_dispatch_outbox WHERE status IN ('failed', 'dead_letter') AND failed_at >= ?) AS outbox_failed_24h,
        (SELECT count(*) FROM med250_admin_principals WHERE status = 'active' AND otp_auth_enabled = 1) AS admins_active,
        (SELECT count(*) FROM med250_admin_sessions WHERE revoked_at IS NULL AND expires_at > ? AND absolute_expires_at > ?) AS sessions_active
    `, [since24h, since24h, since24h, now, now]);
    if (!summary) throw new Error("admin dashboard summary is unavailable");
    const recent = await allRows<D1Row>(this.database, `
      SELECT event_type, created_at
      FROM med250_audit_events
      WHERE event_type LIKE 'admin_%'
      ORDER BY created_at DESC, id DESC
      LIMIT 12
    `);
    return {
      generatedAt: now,
      catalogue: {
        active: numberField(summary, "catalogue_active"),
        orderable: numberField(summary, "catalogue_orderable"),
        pendingReview: numberField(summary, "catalogue_pending"),
      },
      pharmacies: {
        total: numberField(summary, "pharmacies_total"),
        marketplaceApproved: numberField(summary, "pharmacies_approved"),
        dispatchReady: numberField(summary, "pharmacies_dispatch"),
        pendingContactChanges: numberField(summary, "contact_pending"),
      },
      requests: {
        open: numberField(summary, "requests_open"),
        created24h: numberField(summary, "requests_24h"),
        selected24h: numberField(summary, "selected_24h"),
      },
      delivery: {
        pending: numberField(summary, "outbox_pending"),
        retrying: numberField(summary, "outbox_retry"),
        failed24h: numberField(summary, "outbox_failed_24h"),
      },
      access: {
        activeAdmins: numberField(summary, "admins_active"),
        activeSessions: numberField(summary, "sessions_active"),
      },
      recentAdminActivity: recent.map((row) => ({
        eventType: stringField(row, "event_type"),
        createdAt: timestampField(row, "created_at"),
      })),
    };
  }
}

import {
  allRows,
  atomicBatch,
  d1Boolean,
  firstRow,
  newId,
  normalizedE164,
  nowIso,
  runStatement,
  type D1Row,
} from "../../db/index.ts";

export type WebSessionScope = "client" | "pharmacy";

export type WebSessionReceipt = {
  sessionId: string;
  principalId: string;
  actorId: string | null;
  actorType: WebSessionScope | null;
  pharmacyId: string | null;
  e164: string | null;
  verifiedAt: string | null;
  preferredLanguage: string;
  csrfHashHex: string;
  expiresAt: string;
  absoluteExpiresAt: string;
};

export type OtpIssueReceipt = { challengeId: string; expiresAt: string };

export type OtpVerificationReceipt = {
  accepted: boolean;
  reason: string;
  verifiedAt: string | null;
  principalId: string | null;
  actorId: string | null;
  pharmacyId: string | null;
};

const VALID_SCOPE = new Set<WebSessionScope>(["client", "pharmacy"]);
const HEX_64 = /^[0-9a-f]{64}$/;

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

function validExpiry(expiresAt: string, absoluteExpiresAt: string): void {
  const now = Date.now();
  const expires = Date.parse(expiresAt);
  const absolute = Date.parse(absoluteExpiresAt);
  if (!Number.isFinite(expires) || expires <= now || expires > now + 31 * 86_400_000) {
    throw new Error("session expiry is invalid");
  }
  if (!Number.isFinite(absolute) || absolute < expires || absolute > now + 91 * 86_400_000) {
    throw new Error("absolute session expiry is invalid");
  }
}

function verification(
  accepted: boolean,
  reason: string,
  values: Partial<OtpVerificationReceipt & { sessionId: string | null; sessionExpiresAt: string | null }> = {},
): OtpVerificationReceipt & { sessionId: string | null; sessionExpiresAt: string | null } {
  return {
    accepted,
    reason,
    verifiedAt: null,
    principalId: null,
    actorId: null,
    pharmacyId: null,
    sessionId: null,
    sessionExpiresAt: null,
    ...values,
  };
}

export class AuthRepository {
  constructor(private readonly database: D1Database) {}

  async createAnonymousSession(input: {
    principalId: string;
    tokenHashHex: string;
    csrfHashHex: string;
    requestIpHashHex: string;
    userAgentHashHex: string;
    expiresAt: string;
    absoluteExpiresAt: string;
  }): Promise<{ sessionId: string; principalId: string; expiresAt: string }> {
    validExpiry(input.expiresAt, input.absoluteExpiresAt);
    const createdAt = nowIso();
    const sessionId = newId();
    await atomicBatch(this.database, [
      this.database.prepare(`
        insert into med250_web_principals (
          id, subject_type, preferred_language, created_at, updated_at, last_seen_at
        ) values (?, 'client', 'en', ?, ?, ?)
      `).bind(input.principalId, createdAt, createdAt, createdAt),
      this.database.prepare(`
        insert into med250_web_sessions (
          id, principal_id, scope, token_hash, csrf_hash, request_ip_hash,
          user_agent_hash, expires_at, absolute_expires_at, last_seen_at, created_at
        ) values (?, ?, 'client', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sessionId, input.principalId, input.tokenHashHex, input.csrfHashHex,
        input.requestIpHashHex || null, input.userAgentHashHex || null,
        input.expiresAt, input.absoluteExpiresAt, createdAt, createdAt,
      ),
      this.database.prepare(`
        insert into med250_audit_events (event_type, details, created_at)
        values ('anonymous_web_session_created', ?, ?)
      `).bind(JSON.stringify({ scope: "client" }), createdAt),
    ]);
    return { principalId: input.principalId, sessionId, expiresAt: new Date(input.expiresAt).toISOString() };
  }

  async lookupSession(tokenHashHex: string, scope: WebSessionScope): Promise<WebSessionReceipt | null> {
    if (!HEX_64.test(tokenHashHex) || !VALID_SCOPE.has(scope)) return null;
    const now = nowIso();
    const row = await firstRow<D1Row>(this.database, `
      select session.id as session_id, session.principal_id, principal.actor_id,
             actor.actor_type, actor.pharmacy_id, actor.e164, principal.verified_at,
             principal.preferred_language, session.csrf_hash as csrf_hash_hex,
             session.expires_at, session.absolute_expires_at,
             session.last_seen_at, principal.last_seen_at as principal_last_seen_at
      from med250_web_sessions session
      join med250_web_principals principal on principal.id = session.principal_id
      left join med250_actors actor on actor.id = principal.actor_id
      where session.token_hash = ? and session.scope = ? and principal.subject_type = ?
        and session.revoked_at is null and session.expires_at > ? and session.absolute_expires_at > ?
      limit 1
    `, [tokenHashHex, scope, scope, now, now]);
    if (!row) return null;

    const actorId = nullableStringField(row, "actor_id");
    if (actorId) {
      const actorType = nullableStringField(row, "actor_type");
      const e164 = nullableStringField(row, "e164");
      const pharmacyId = nullableStringField(row, "pharmacy_id");
      const classification = e164 ? await this.classifyNumber(e164) : null;
      const invalid = actorType !== scope
        || !classification
        || (scope === "client" && classification.actorType === "pharmacy")
        || (scope === "pharmacy" && (
          classification.actorType !== "pharmacy"
          || !classification.pharmacyLoginEnabled
          || classification.pharmacyId !== pharmacyId
        ));
      if (invalid) {
        await runStatement(this.database, `
          update med250_web_sessions set revoked_at = ? where id = ? and revoked_at is null
        `, [now, stringField(row, "session_id")]);
        return null;
      }
    }

    const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString();
    if (stringField(row, "last_seen_at") < fiveMinutesAgo) {
      await atomicBatch(this.database, [
        this.database.prepare("update med250_web_sessions set last_seen_at = ? where id = ?")
          .bind(now, stringField(row, "session_id")),
        this.database.prepare("update med250_web_principals set last_seen_at = ?, updated_at = ? where id = ?")
          .bind(now, now, stringField(row, "principal_id")),
      ]);
    }

    const actorType = nullableStringField(row, "actor_type");
    if (actorType !== null && !VALID_SCOPE.has(actorType as WebSessionScope)) {
      throw new Error("Database actor type is invalid.");
    }
    return {
      sessionId: stringField(row, "session_id"),
      principalId: stringField(row, "principal_id"),
      actorId,
      actorType: actorType as WebSessionScope | null,
      pharmacyId: nullableStringField(row, "pharmacy_id"),
      e164: nullableStringField(row, "e164"),
      verifiedAt: nullableTimestampField(row, "verified_at"),
      preferredLanguage: stringField(row, "preferred_language"),
      csrfHashHex: stringField(row, "csrf_hash_hex"),
      expiresAt: timestampField(row, "expires_at"),
      absoluteExpiresAt: timestampField(row, "absolute_expires_at"),
    };
  }

  async classifyNumber(e164: string): Promise<{
    actorType: WebSessionScope;
    pharmacyId: string | null;
    pharmacyLoginEnabled: boolean;
  }> {
    const normalized = normalizedE164(e164);
    const known = await firstRow<D1Row>(this.database, `
      select resolution_status, pharmacy_id
      from med250_known_pharmacy_numbers
      where e164 = ? and resolution_status <> 'retired'
    `, [normalized]);
    if (known && stringField(known, "resolution_status") === "ambiguous") {
      return { actorType: "pharmacy", pharmacyId: null, pharmacyLoginEnabled: false };
    }
    const knownPharmacyId = known ? nullableStringField(known, "pharmacy_id") : null;
    const contact = await firstRow<D1Row>(this.database, `
      select contact.pharmacy_id, contact.login_enabled,
             pharmacy.licence_status, pharmacy.licence_expires_on
      from med250_pharmacy_contacts contact
      join med250_pharmacies pharmacy on pharmacy.id = contact.pharmacy_id
      where contact.channel = 'whatsapp' and contact.e164 = ?
        and contact.verified_at is not null and contact.active = 1
        and (? is null or contact.pharmacy_id = ?)
      order by contact.verified_at desc, contact.id
      limit 1
    `, [normalized, knownPharmacyId, knownPharmacyId]);
    if (!contact) {
      return known
        ? { actorType: "pharmacy", pharmacyId: knownPharmacyId, pharmacyLoginEnabled: false }
        : { actorType: "client", pharmacyId: null, pharmacyLoginEnabled: false };
    }
    const licenceExpiry = nullableStringField(contact, "licence_expires_on");
    const loginEnabled = d1Boolean(field(contact, "login_enabled"), "login_enabled")
      && stringField(contact, "licence_status") === "current"
      && licenceExpiry !== null
      && licenceExpiry.slice(0, 10) >= nowIso().slice(0, 10);
    return {
      actorType: "pharmacy",
      pharmacyId: stringField(contact, "pharmacy_id"),
      pharmacyLoginEnabled: loginEnabled,
    };
  }

  async recordUnknownPharmacyLoginAttempt(e164HashHex: string, requestIpHashHex: string): Promise<void> {
    if (!HEX_64.test(e164HashHex) || !HEX_64.test(requestIpHashHex)) throw new Error("authentication fingerprint is invalid");
    const now = Date.now();
    const rows = await allRows<D1Row>(this.database, `
      select
        sum(case when e164_hash = ? and created_at >= ? then 1 else 0 end) as phone_hour,
        sum(case when request_ip_hash = ? and created_at >= ? then 1 else 0 end) as source_five_minutes,
        sum(case when request_ip_hash = ? and created_at >= ? then 1 else 0 end) as source_hour,
        sum(case when created_at >= ? then 1 else 0 end) as global_minute
      from med250_web_auth_rate_events
    `, [
      e164HashHex, new Date(now - 3_600_000).toISOString(),
      requestIpHashHex, new Date(now - 300_000).toISOString(),
      requestIpHashHex, new Date(now - 3_600_000).toISOString(),
      new Date(now - 60_000).toISOString(),
    ]);
    const row = rows[0] ?? {};
    if (Number(row.phone_hour ?? 0) >= 5 || Number(row.source_five_minutes ?? 0) >= 10
      || Number(row.source_hour ?? 0) >= 30 || Number(row.global_minute ?? 0) >= 60) {
      throw new Error("otp_source_rate_limit");
    }
    await runStatement(this.database, `
      insert into med250_web_auth_rate_events (event_type, e164_hash, request_ip_hash, created_at)
      values ('unknown_pharmacy_login', ?, ?, ?)
    `, [e164HashHex, requestIpHashHex, nowIso()]);
  }

  async issueOtp(input: {
    challengeId: string;
    principalId: string | null;
    e164: string;
    actorType: WebSessionScope;
    codeHashHex: string;
    requestIpHashHex: string;
    ciphertext: string;
    nonce: string;
    expiresAt: string;
  }): Promise<OtpIssueReceipt> {
    const normalized = normalizedE164(input.e164);
    if (!VALID_SCOPE.has(input.actorType) || !HEX_64.test(input.codeHashHex) || !HEX_64.test(input.requestIpHashHex)) {
      throw new Error("otp request is invalid");
    }
    const expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() + 180_000 || expiry > Date.now() + 600_000) {
      throw new Error("otp expiry is invalid");
    }
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(input.ciphertext) || !/^[A-Za-z0-9_-]{16,64}$/.test(input.nonce)) {
      throw new Error("otp encrypted payload is invalid");
    }
    const classification = await this.classifyNumber(normalized);
    if (input.actorType === "client") {
      if (!input.principalId || classification.actorType === "pharmacy") {
        throw new Error("registered pharmacy numbers must use pharmacy login");
      }
      const principal = await firstRow(this.database, `
        select id from med250_web_principals where id = ? and subject_type = 'client'
      `, [input.principalId]);
      if (!principal) throw new Error("client principal is invalid");
    } else if (input.principalId || classification.actorType !== "pharmacy" || !classification.pharmacyLoginEnabled) {
      throw new Error("pharmacy whatsapp number is not registered for login");
    }

    const now = Date.now();
    const rate = await firstRow<D1Row>(this.database, `
      select
        sum(case when e164 = ? and created_at >= ? then 1 else 0 end) as phone_minute,
        sum(case when e164 = ? and created_at >= ? then 1 else 0 end) as phone_hour,
        sum(case when request_ip_hash = ? and created_at >= ? then 1 else 0 end) as source_five_minutes,
        sum(case when request_ip_hash = ? and created_at >= ? then 1 else 0 end) as source_hour,
        sum(case when created_at >= ? then 1 else 0 end) as global_minute
      from med250_otp_challenges
    `, [
      normalized, new Date(now - 60_000).toISOString(),
      normalized, new Date(now - 3_600_000).toISOString(),
      input.requestIpHashHex, new Date(now - 300_000).toISOString(),
      input.requestIpHashHex, new Date(now - 3_600_000).toISOString(),
      new Date(now - 60_000).toISOString(),
    ]);
    if (Number(rate?.phone_minute ?? 0) >= 1) throw new Error("otp_phone_minute_rate_limit");
    if (Number(rate?.phone_hour ?? 0) >= 5) throw new Error("otp_phone_hour_rate_limit");
    if (Number(rate?.source_five_minutes ?? 0) >= 10 || Number(rate?.source_hour ?? 0) >= 30
      || Number(rate?.global_minute ?? 0) >= 60) throw new Error("otp_source_rate_limit");

    const createdAt = nowIso();
    const outboxId = newId();
    await atomicBatch(this.database, [
      this.database.prepare(`
        insert into med250_otp_challenges (
          id, principal_id, e164, actor_type, purpose, code_hash, request_ip_hash,
          encrypted_code, encryption_nonce, expires_at, delivery_status, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
      `).bind(
        input.challengeId, input.principalId, normalized, input.actorType,
        input.actorType === "pharmacy" ? "pharmacy_login" : "client_registration",
        input.codeHashHex, input.requestIpHashHex, input.ciphertext, input.nonce,
        input.expiresAt, createdAt,
      ),
      this.database.prepare(`
        insert into med250_dispatch_outbox (
          id, dedupe_key, kind, otp_challenge_id, recipient_e164, payload,
          status, available_at, created_at, updated_at
        ) values (?, ?, 'otp', ?, ?, ?, 'pending', ?, ?, ?)
      `).bind(
        outboxId, `otp:${input.challengeId}`, input.challengeId, normalized,
        JSON.stringify({ challenge_id: input.challengeId, actor_type: input.actorType, ciphertext: input.ciphertext, nonce: input.nonce }),
        createdAt, createdAt, createdAt,
      ),
      this.database.prepare(`
        insert into med250_audit_events (event_type, details, created_at)
        values ('web_otp_queued', ?, ?)
      `).bind(JSON.stringify({ actor_type: input.actorType }), createdAt),
    ]);
    return { challengeId: input.challengeId, expiresAt: new Date(input.expiresAt).toISOString() };
  }

  async verifyOtp(input: {
    challengeId: string;
    principalId: string | null;
    e164: string;
    actorType: WebSessionScope;
    codeHashHex: string;
    session?: {
      tokenHashHex: string;
      csrfHashHex: string;
      requestIpHashHex: string;
      userAgentHashHex: string;
      expiresAt: string;
      absoluteExpiresAt: string;
    };
  }): Promise<OtpVerificationReceipt & { sessionId: string | null; sessionExpiresAt: string | null }> {
    const normalized = normalizedE164(input.e164);
    const challenge = await firstRow<D1Row>(this.database, `
      select * from med250_otp_challenges where id = ? and e164 = ? and actor_type = ?
    `, [input.challengeId, normalized, input.actorType]);
    if (!challenge) return verification(false, "invalid");
    if (nullableStringField(challenge, "consumed_at")) return verification(false, "used");
    const now = nowIso();
    if (stringField(challenge, "expires_at") <= now) {
      await runStatement(this.database, "update med250_otp_challenges set consumed_at = ? where id = ? and consumed_at is null", [now, input.challengeId]);
      return verification(false, "expired");
    }
    const attempts = Number(field(challenge, "attempts"));
    const maxAttempts = Number(field(challenge, "max_attempts"));
    if (attempts >= maxAttempts) {
      await runStatement(this.database, "update med250_otp_challenges set consumed_at = ? where id = ? and consumed_at is null", [now, input.challengeId]);
      return verification(false, "attempts_exhausted");
    }
    if (nullableStringField(challenge, "principal_id") !== input.principalId) return verification(false, "invalid");
    if (stringField(challenge, "code_hash") !== input.codeHashHex) {
      await runStatement(this.database, `
        update med250_otp_challenges
        set attempts = attempts + 1,
            consumed_at = case when attempts + 1 >= max_attempts then ? else consumed_at end
        where id = ? and consumed_at is null
      `, [now, input.challengeId]);
      return verification(false, "incorrect");
    }

    const classification = await this.classifyNumber(normalized);
    if (classification.actorType !== input.actorType
      || input.actorType === "pharmacy" && !classification.pharmacyLoginEnabled) {
      throw new Error("whatsapp number belongs to a different actor type");
    }
    const existingActor = await firstRow<D1Row>(this.database, "select id from med250_actors where e164 = ?", [normalized]);
    const actorId = existingActor ? stringField(existingActor, "id") : newId();
    const principalId = input.actorType === "client" ? input.principalId : newId();
    if (!principalId) throw new Error("verified principal receipt is missing");
    if (input.session) validExpiry(input.session.expiresAt, input.session.absoluteExpiresAt);
    const sessionId = input.session ? newId() : null;

    const statements: D1PreparedStatement[] = [
      this.database.prepare(`
        insert into med250_actors (
          id, e164, actor_type, pharmacy_id, first_seen_at, last_seen_at,
          inbound_message_count, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, 0, ?, ?)
        on conflict(e164) do update set
          actor_type = excluded.actor_type,
          pharmacy_id = excluded.pharmacy_id,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `).bind(actorId, normalized, input.actorType, classification.pharmacyId, now, now, now, now),
    ];
    if (input.actorType === "client") {
      statements.push(this.database.prepare(`
        update med250_web_principals
        set actor_id = ?, verified_at = ?, last_seen_at = ?, updated_at = ?
        where id = ? and subject_type = 'client' and actor_id is null
      `).bind(actorId, now, now, now, principalId));
    } else {
      statements.push(this.database.prepare(`
        insert into med250_web_principals (
          id, subject_type, actor_id, verified_at, preferred_language,
          created_at, updated_at, last_seen_at
        ) values (?, 'pharmacy', ?, ?, 'en', ?, ?, ?)
      `).bind(principalId, actorId, now, now, now, now));
    }
    statements.push(
      this.database.prepare(`
        insert into med250_otp_redemptions (challenge_id, principal_id, redeemed_at)
        values (?, ?, ?)
      `).bind(input.challengeId, principalId, now),
      this.database.prepare(`
        update med250_otp_challenges set attempts = attempts + 1, consumed_at = ?
        where id = ? and consumed_at is null and code_hash = ?
      `).bind(now, input.challengeId, input.codeHashHex),
      this.database.prepare(`
        insert into med250_audit_events (event_type, actor_id, details, created_at)
        values ('web_otp_verified', ?, ?, ?)
      `).bind(actorId, JSON.stringify({ actor_type: input.actorType }), now),
    );
    if (input.session && sessionId) {
      statements.push(this.database.prepare(`
        insert into med250_web_sessions (
          id, principal_id, scope, token_hash, csrf_hash, request_ip_hash,
          user_agent_hash, expires_at, absolute_expires_at, last_seen_at, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sessionId, principalId, input.actorType, input.session.tokenHashHex, input.session.csrfHashHex,
        input.session.requestIpHashHex || null, input.session.userAgentHashHex || null,
        input.session.expiresAt, input.session.absoluteExpiresAt, now, now,
      ));
    }
    try {
      await atomicBatch(this.database, statements);
    } catch (error) {
      const redeemed = await firstRow(this.database, "select challenge_id from med250_otp_redemptions where challenge_id = ?", [input.challengeId]);
      if (redeemed) return verification(false, "used");
      throw error;
    }
    return verification(true, "accepted", {
      verifiedAt: now,
      principalId,
      actorId,
      pharmacyId: classification.pharmacyId,
      sessionId,
      sessionExpiresAt: input.session ? new Date(input.session.expiresAt).toISOString() : null,
    });
  }

  async revokeSession(tokenHashHex: string, scope: WebSessionScope): Promise<boolean> {
    const result = await runStatement(this.database, `
      update med250_web_sessions set revoked_at = coalesce(revoked_at, ?)
      where token_hash = ? and scope = ? and revoked_at is null
    `, [nowIso(), tokenHashHex, scope]);
    return (result.meta.changes ?? 0) > 0;
  }
}

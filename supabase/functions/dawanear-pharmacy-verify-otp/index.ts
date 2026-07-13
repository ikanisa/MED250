import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  adminClient,
  anonClient,
  corsHeaders,
  eligiblePharmacies,
  errorResponse,
  hashOtp,
  HttpError,
  internalEmailForPhone,
  json,
  normalizeChallengeId,
  normalizeOtp,
  normalizeRwandaPhone,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const body = await request.json().catch(() => ({}));
    const phone = normalizeRwandaPhone(body?.phone);
    const challengeId = normalizeChallengeId(body?.challengeId);
    const code = normalizeOtp(body?.code);
    const codeHash = await hashOtp(phone, code);
    const client = adminClient();

    const { data: consumeRows, error: consumeError } = await client.rpc("dawanear_consume_pharmacy_otp", {
      p_challenge_id: challengeId,
      p_phone: phone,
      p_code_hash: codeHash,
    });
    if (consumeError) throw consumeError;
    const result = Array.isArray(consumeRows) ? consumeRows[0] : null;
    if (!result?.accepted) {
      const message = result?.reason === "expired"
        ? "This code has expired. Request a new WhatsApp code."
        : "The WhatsApp code is incorrect or no longer active.";
      throw new HttpError(message, 400);
    }

    const pharmacies = await eligiblePharmacies(client, phone);
    if (!pharmacies.length) throw new HttpError("This WhatsApp number is not linked to an approved pharmacy.", 403);

    const { data: identity, error: identityError } = await client
      .from("dawanear_pharmacy_identities")
      .select("user_id")
      .eq("phone", phone)
      .maybeSingle();
    if (identityError) throw identityError;

    const email = await internalEmailForPhone(phone);
    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    let userId = identity?.user_id as string | undefined;

    if (userId) {
      const { data: current, error: currentError } = await client.auth.admin.getUserById(userId);
      if (currentError || !current.user) throw currentError ?? new Error("Pharmacy user is unavailable");
      const { error: updateError } = await client.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
        password,
        app_metadata: { ...current.user.app_metadata, provider: "whatsapp_cloud_otp", role: "pharmacy_staff" },
        user_metadata: { ...current.user.user_metadata, whatsapp_e164: phone },
      });
      if (updateError) throw updateError;
    } else {
      const { data: created, error: createError } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
        app_metadata: { provider: "whatsapp_cloud_otp", role: "pharmacy_staff" },
        user_metadata: { whatsapp_e164: phone },
      });
      if (createError || !created.user) throw createError ?? new Error("Pharmacy user was not created");
      userId = created.user.id;
      const { error: mapError } = await client.from("dawanear_pharmacy_identities").insert({ phone, user_id: userId });
      if (mapError) {
        await client.auth.admin.deleteUser(userId);
        throw mapError;
      }
    }

    const now = new Date().toISOString();
    const { error: identityUpdateError } = await client
      .from("dawanear_pharmacy_identities")
      .update({ verified_at: now, last_login_at: now, updated_at: now })
      .eq("phone", phone)
      .eq("user_id", userId);
    if (identityUpdateError) throw identityUpdateError;

    const { error: contactLoginError } = await client
      .from("dawanear_pharmacy_contacts")
      .update({ last_login_at: now })
      .eq("contact_type", "whatsapp")
      .eq("e164", phone)
      .eq("is_login_enabled", true)
      .in("verification_status", ["source_verified", "admin_verified"]);
    if (contactLoginError) throw contactLoginError;

    const { error: membershipError } = await client.from("dawanear_pharmacy_memberships").upsert(
      pharmacies.map((pharmacy) => ({
        pharmacy_id: pharmacy.id,
        user_id: userId,
        role: "manager",
        status: "active",
        created_by: userId,
        updated_at: now,
      })),
      { onConflict: "pharmacy_id,user_id" },
    );
    if (membershipError) throw membershipError;

    const sessionClient = anonClient();
    const { data: signInData, error: signInError } = await sessionClient.auth.signInWithPassword({ email, password });
    if (signInError || !signInData.session) throw signInError ?? new Error("Permanent pharmacy session was not created");

    return json(request, {
      accessToken: signInData.session.access_token,
      refreshToken: signInData.session.refresh_token,
      expiresAt: signInData.session.expires_at,
    });
  } catch (error) {
    console.error("dawanear-pharmacy-verify-otp", error instanceof Error ? error.message : error);
    return errorResponse(request, error);
  }
});

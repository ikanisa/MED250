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
  normalizeInternationalPhone,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    // Reject an untrusted browser origin before the one-time code is consumed
    // or any permanent identity, membership, password, or session is changed.
    const responseCors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseCors });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const body = await request.json().catch(() => ({}));
    const phone = normalizeInternationalPhone(body?.phone);
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
    if (pharmacies.length !== 1) {
      throw new HttpError("This WhatsApp number is not linked to exactly one approved pharmacy.", 403);
    }

    const { data: identity, error: identityError } = await client
      .from("dawanear_pharmacy_identities")
      .select("user_id")
      .eq("phone", phone)
      .maybeSingle();
    if (identityError) throw identityError;

    const email = await internalEmailForPhone(phone);
    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    let userId = identity?.user_id as string | undefined;
    let createdUserId: string | null = null;

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
      createdUserId = userId;
    }

    const { data: bindingRows, error: bindingError } = await client.rpc("dawanear_bind_pharmacy_identity", {
      p_phone: phone,
      p_user_id: userId,
    });
    const binding = Array.isArray(bindingRows) ? bindingRows[0] : null;
    if (bindingError || binding?.bound_pharmacy_id !== pharmacies[0].id) {
      if (createdUserId) await client.auth.admin.deleteUser(createdUserId);
      throw bindingError ?? new Error("Pharmacy identity authority changed during verification");
    }

    // Password sign-in is intentionally protected by Turnstile in production.
    // The WhatsApp OTP above already established possession, so mint a
    // single-use server-side email token without sending email and exchange it
    // through the normal Auth verifier. This preserves CAPTCHA on public
    // password endpoints while avoiding a second, unavailable browser proof.
    const { data: linkData, error: linkError } = await client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) throw linkError ?? new Error("Permanent pharmacy session link was not created");

    const sessionClient = anonClient();
    const { data: signInData, error: signInError } = await sessionClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
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

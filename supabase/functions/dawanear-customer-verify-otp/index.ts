import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  adminClient,
  authenticatedCustomer,
  corsHeaders,
  errorResponse,
  hashCustomerOtp,
  HttpError,
  json,
  normalizeChallengeId,
  normalizeInternationalPhone,
  normalizeOtp,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    const responseCors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseCors });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const customer = await authenticatedCustomer(request);
    if (!customer.isAnonymous) throw new HttpError("Use the customer checkout session to verify WhatsApp.", 403);
    const body = await request.json().catch(() => ({}));
    const phone = normalizeInternationalPhone(body?.phone);
    const challengeId = normalizeChallengeId(body?.challengeId);
    const code = normalizeOtp(body?.code);
    const codeHash = await hashCustomerOtp(customer.id, phone, code);
    const client = adminClient();

    const { data: consumeRows, error: consumeError } = await client.rpc("dawanear_consume_customer_otp", {
      p_challenge_id: challengeId,
      p_user_id: customer.id,
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

    const { data: verifiedAt, error: profileError } = await client.rpc("dawanear_mark_customer_whatsapp_verified", {
      p_user_id: customer.id,
      p_phone: phone,
    });
    if (profileError) throw profileError;

    return json(request, {
      phone,
      verifiedAt: String(verifiedAt ?? new Date().toISOString()),
      message: "WhatsApp verified. Your request is ready to send.",
    });
  } catch (error) {
    console.error("dawanear-customer-verify-otp", error instanceof Error ? error.message : error);
    return errorResponse(request, error);
  }
});

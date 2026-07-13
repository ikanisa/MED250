import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  adminClient,
  corsHeaders,
  eligiblePharmacies,
  enforceOtpRateLimits,
  errorResponse,
  generateOtp,
  hashOtp,
  HttpError,
  json,
  normalizeRwandaPhone,
  requestSourceHash,
  sendWhatsappOtp,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const body = await request.json().catch(() => ({}));
    const phone = normalizeRwandaPhone(body?.phone);
    const client = adminClient();
    const sourceHash = await requestSourceHash(request);
    await enforceOtpRateLimits(client, phone, sourceHash);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const code = generateOtp();
    const codeHash = await hashOtp(phone, code);

    await client
      .from("dawanear_pharmacy_otp_challenges")
      .update({ used_at: now.toISOString() })
      .eq("phone", phone)
      .is("used_at", null);

    const { data: challenge, error: insertError } = await client
      .from("dawanear_pharmacy_otp_challenges")
      .insert({ phone, code_hash: codeHash, source_hash: sourceHash, expires_at: expiresAt })
      .select("id")
      .single();
    if (insertError || !challenge) throw insertError ?? new Error("Challenge was not created");

    const pharmacies = await eligiblePharmacies(client, phone);
    if (!pharmacies.length) {
      await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "suppressed" }).eq("id", challenge.id);
      return json(request, {
        registered: false,
        adminWhatsapp: "250795588248",
        message: "This WhatsApp number is not registered to a pharmacy.",
      });
    } else {
      try {
        await sendWhatsappOtp(phone, code);
        await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "sent" }).eq("id", challenge.id);
      } catch (error) {
        await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "failed", used_at: new Date().toISOString() }).eq("id", challenge.id);
        throw error;
      }
    }

    return json(request, {
      registered: true,
      challengeId: challenge.id,
      expiresAt,
      message: "A WhatsApp verification code has been sent.",
    });
  } catch (error) {
    console.error("dawanear-pharmacy-send-otp", error instanceof Error ? error.message : error);
    return errorResponse(request, error);
  }
});
